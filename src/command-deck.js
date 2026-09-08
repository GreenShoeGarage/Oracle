import { stagehandDashboard } from './stagehand-core.js';

const MANAGERS = new Set(['owner', 'organizer', 'superuser']);
const LIMIT = 25;
const iso = value => value ? new Date(value).toISOString() : null;
const section = (key, title, rows, destination, total = rows.length) => ({
  key, title, total: Number(total), destination,
  items: rows.slice(0, LIMIT), truncated: Number(total) > LIMIT,
});

// A read-only projection of operational work, never a second workflow engine.
// Do not query arc selections, reflections, connection responses or consent.
export async function commandDeckSnapshot(db, event, user) {
  const id = event.id;
  const people = (await db.query(`SELECT count(*)::int AS members,
    count(*) FILTER (WHERE m.role='player')::int AS players
    FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.event_id=$1 AND NOT u.is_disabled`, [id])).rows[0];
  const characters = (await db.query(`SELECT id,profile->>'name' AS title,status,user_id
    FROM characters WHERE event_id=$1 AND status<>'retired' ORDER BY created_at,id`, [id])).rows;
  const pending = characters.filter(c => c.status === 'pending').map(c => ({
    id: c.id, title: c.title, detail: 'Character awaiting organizer approval.', destination: 'character',
  }));
  const unassigned = characters.filter(c => !c.user_id).map(c => ({
    id: c.id, title: c.title, detail: 'No player assigned. Review the sheet before assigning.', destination: 'character',
  }));
  // This predicate deliberately ignores offered/kept/paused/dismissed and all
  // confirmation records. An organizer sees assignment problems, not choices.
  const connectionIssues = (await db.query(`SELECT a.id,a.snapshot->>'title' AS title,
    a.character_id,
    CASE WHEN c.id IS NULL OR c.user_id IS DISTINCT FROM a.assigned_user_id
      OR c.status<>'approved' OR u.is_disabled OR u.id IS NULL
      OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=a.event_id AND m.user_id=a.assigned_user_id)
      THEN 'The assigned character or player is no longer available. Review the assignment.'
      ELSE 'The named counterpart is no longer available. Offer a role-based alternative.' END AS detail,
    count(*) OVER()::int AS total
    FROM connection_assignments a
    LEFT JOIN characters c ON c.id=a.character_id AND c.event_id=a.event_id
    LEFT JOIN users u ON u.id=a.assigned_user_id
    LEFT JOIN characters peer ON peer.id=a.counterpart_character_id AND peer.event_id=a.event_id
    LEFT JOIN users pu ON pu.id=a.counterpart_user_id
    WHERE a.event_id=$1 AND (
      c.id IS NULL OR c.user_id IS DISTINCT FROM a.assigned_user_id OR c.status<>'approved'
      OR u.id IS NULL OR u.is_disabled
      OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=a.event_id AND m.user_id=a.assigned_user_id)
      OR ((a.counterpart_character_id IS NOT NULL OR a.counterpart_user_id IS NOT NULL) AND (
        peer.id IS NULL OR peer.user_id IS DISTINCT FROM a.counterpart_user_id OR peer.status<>'approved'
        OR pu.id IS NULL OR pu.is_disabled OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=a.event_id AND m.user_id=a.counterpart_user_id))))
    ORDER BY a.created_at,a.id LIMIT $2`, [id, LIMIT])).rows;
  const contributionRows = (await db.query(`SELECT c.id,c.project_id,p.title,p.status AS project_status,
    c.created_at, count(*) OVER()::int AS total
    FROM community_project_contributions c JOIN community_projects p ON p.id=c.project_id AND p.event_id=c.event_id
    WHERE c.event_id=$1 AND c.status='submitted' ORDER BY c.created_at,c.id LIMIT $2`, [id, LIMIT])).rows;
  const bulletins = (await db.query(`SELECT id,document->>'title' AS title,status,
    published_version,updated_at,count(*) OVER()::int AS total
    FROM story_entries WHERE event_id=$1 AND kind='bulletin' AND status IN ('draft','submitted')
    ORDER BY CASE WHEN status='submitted' THEN 0 ELSE 1 END,updated_at,id LIMIT $2`, [id, LIMIT])).rows;
  const projectCounts = (await db.query(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE status='open')::int AS open,
    count(*) FILTER (WHERE status='completed')::int AS completed
    FROM community_projects WHERE event_id=$1`, [id])).rows[0];
  const projects = (await db.query(`SELECT id,title,status,completed_at FROM community_projects
    WHERE event_id=$1 ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,created_at,id LIMIT 50`, [id])).rows;
  const milestones = projects.length ? (await db.query(`SELECT m.id,m.project_id,m.title,m.required_count,m.contribution_mode,
    CASE WHEN m.contribution_mode='resource' THEN COALESCE(sum(c.units) FILTER(WHERE c.status='accepted' AND c.kind='resource'),0)::int
      WHEN m.counting_rule='distinct_accounts' THEN count(DISTINCT c.user_id) FILTER(WHERE c.status='accepted')::int
      ELSE count(c.id) FILTER(WHERE c.status='accepted')::int END AS accepted,
    EXISTS(SELECT 1 FROM community_project_receipts r WHERE r.event_id=m.event_id AND r.project_id=m.project_id
      AND r.milestone_id=m.id AND r.kind='milestone_complete') AS receipted
    FROM community_project_milestones m LEFT JOIN community_project_contributions c ON c.event_id=m.event_id AND c.milestone_id=m.id
    WHERE m.event_id=$1 AND m.project_id=ANY($2::uuid[]) GROUP BY m.id ORDER BY m.project_id,m.position`, [id, projects.map(p => p.id)])).rows : [];
  // Use STAGEHAND's own availability/capacity rules, including revoked staff,
  // paused events, legacy attendance and whole-party capacity. GET does not
  // release overdue parties or advance any scene.
  const operations = await stagehandDashboard(db, event, user, { manage: true });
  const activeParties = operations.parties.filter(p => ['waiting', 'dispatched'].includes(p.status));
  const sceneIssues = operations.encounters.filter(e => e.state === 'open' && e.availability === 'unavailable').map(e => ({
    id: e.id, title: e.title, detail: e.reason || 'Review scene readiness.', destination: 'scenes',
  }));
  const partyIssues = activeParties.filter(p => p.overdue || p.blockedReason || p.canDispatch).map(p => ({
    id: p.id, title: p.name,
    detail: p.overdue ? 'Return is overdue. Ask staff to acknowledge the party’s return; no seats have been released automatically.'
      : p.blockedReason || 'Party is ready for staff to review and dispatch.', destination: 'scenes',
  }));
  const sections = [
    section('scenes', 'Scenes and parties', [...partyIssues, ...sceneIssues], 'scenes'),
    section('approvals', 'Character approvals', pending, 'characters'),
    section('unassigned', 'Unassigned characters', unassigned, 'characters'),
    section('contributions', 'Project contributions', contributionRows.map(c => ({ id:c.id, projectId:c.project_id,
      title:c.title, detail:c.project_status === 'closed' ? 'Submitted contribution on a closed project. Review its history.' : 'Submitted contribution awaiting review; it does not count yet.',
      destination:'project', at:iso(c.created_at) })), 'projects', contributionRows[0]?.total || 0),
    section('bulletins', 'BROADSIDE drafts and submissions', bulletins.map(b => ({ id:b.id,title:b.title,
      detail:`${b.status === 'submitted' ? 'Submitted for organizer publication.' : 'Draft needs editorial review.'}${b.published_version ? ' An earlier publication remains separate.' : ''}`,
      destination:'bulletin', at:iso(b.updated_at) })), 'bulletins', bulletins[0]?.total || 0),
    section('connections', 'Connection assignment problems', connectionIssues.map(c => ({ id:c.id,title:c.title || 'Connection assignment',detail:c.detail,destination:'connections' })), 'connections', connectionIssues[0]?.total || 0),
  ];
  const installed = (await db.query(`SELECT starter_key,snapshot FROM starter_experience_installs
    WHERE event_id=$1 ORDER BY installed_at DESC,id DESC LIMIT 3`, [id])).rows;
  const now = new Date(operations.serverTime);
  const definition = (await db.query('SELECT definition FROM event_adventures WHERE event_id=$1', [id])).rows[0]?.definition;
  const upcoming = (definition?.nodes || []).filter(n => n.type === 'wayfinder' && n.startsAt && Date.parse(n.startsAt) > now.getTime())
    .sort((a,b) => Date.parse(a.startsAt)-Date.parse(b.startsAt) || a.id.localeCompare(b.id))
    .slice(0,LIMIT).map(n => ({ id:n.id,title:n.title,location:n.location,startsAt:iso(n.startsAt),availability:n.availability }));
  return {
    event:{id,name:event.name,status:event.status,role:event.role,version:event.version,themeId:event.setup?.theme?.id},
    checkedAt:operations.serverTime, readOnly:event.status === 'archived', playActive:['live','rehearsal'].includes(event.status),
    counts:{members:people.members,players:people.players,characters:characters.length,
      approvals:pending.length,unassigned:unassigned.length,contributions:sections[3].total,bulletins:sections[4].total,
      connections:sections[5].total,openProjects:projectCounts.open,completedProjects:projectCounts.completed,
      openScenes:operations.encounters.filter(e => e.available).length,
      waitingParties:activeParties.filter(p => p.status === 'waiting').length,
      dispatchedParties:activeParties.filter(p => p.status === 'dispatched').length},
    attention:{total:sections.reduce((sum,s) => sum+s.total,0),sections},
    projects:{total:projectCounts.total,truncated:projectCounts.total > projects.length,items:projects.map(p => ({
      id:p.id,title:p.title,status:p.status,completedAt:iso(p.completed_at),milestones:milestones.filter(m => m.project_id === p.id).map(m => ({
        id:m.id,title:m.title,mode:m.contribution_mode,accepted:Number(m.accepted),required:m.required_count,
        complete:m.receipted || Number(m.accepted) >= m.required_count,historicalCompletion:m.receipted && Number(m.accepted) < m.required_count,
      })),
    }))},
    scenes:{enabled:event.setup.enabledInstruments.includes('stagehand'),total:operations.encounters.length,
      truncated:operations.encounters.length > LIMIT,items:operations.encounters.slice(0,LIMIT).map(e => ({
        id:e.id,title:e.title,location:e.location,state:e.state,availability:e.availability,reason:e.reason,
        occupied:e.attendanceCount,capacity:e.capacity,ready:e.readiness.every(r => r.ready),
      })),upcoming},
    beats:installed.map(i => ({key:i.starter_key,title:i.snapshot.title,
      suggestion: ['ended','archived'].includes(event.status) ? 'Review the ending with the group. Record corrections through the original tools.'
        : ['draft','rehearsal'].includes(event.status) ? 'Review the run sheet, assign characters, then rehearse the first conversation.'
        : 'Offer a connection opening, leave space for personal scenes, then invite a useful project contribution.',
      unfinishedEnding:typeof i.snapshot.unfinishedEnding === 'string' ? i.snapshot.unfinishedEnding : '',
    })),
  };
}

export function createCommandDeckHandler({pool,helpers}) {
  const { membership, identifier, fail, send } = helpers;
  return async function handle({res,path,url,method,user}) {
    const match = /^\/api\/events\/([^/]+)\/command-deck$/.exec(path);
    if (!match) return false;
    if (!user) fail(401,'Sign in to continue.');
    if (method !== 'GET') { res.setHeader('Allow','GET'); fail(405,'The Command Deck is read-only. Use the original workflow to make a change.'); }
    if (url.search) fail(400,'The Command Deck does not accept alternate audiences or query options.');
    const id = identifier(match[1]);
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const event = await membership(client,id,user.id);
      if (!MANAGERS.has(event.role)) fail(403,'Only event organizers can open the Command Deck. Staff should use their assigned tools.');
      result = await commandDeckSnapshot(client,event,user);
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
    // Recheck current authority after the snapshot. A demotion during a slow
    // report must not return privileged data from the earlier snapshot.
    const current = await membership(pool,id,user.id);
    if (!MANAGERS.has(current.role)) fail(403,'Your organizer access has changed. Reopen your event.');
    res.setHeader('Cache-Control','private, no-store');
    send(res,200,result); return true;
  };
}

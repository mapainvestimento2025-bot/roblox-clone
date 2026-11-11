<?php
// ============================================================
//  api.php — API central do Roblox Clone para ProFreeHost
//  Hospede este arquivo (e db.php) no ProFreeHost em public_html/api/
// ============================================================

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/db.php';

$action = $_GET['action'] ?? $_POST['action'] ?? '';

// Se não vier action, tenta pegar do body JSON
if (!$action) {
    $raw = file_get_contents('php://input');
    $json = json_decode($raw, true);
    if (is_array($json) && isset($json['action'])) {
        $action = $json['action'];
    }
}

$body = [];
$raw = file_get_contents('php://input');
if ($raw) {
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) $body = $decoded;
}

// ── Roteamento ───────────────────────────────────────────────
switch ($action) {

    case '':
    case 'health':
        $db = getDb();
        $r  = $db->query("SELECT COUNT(*) as c FROM users");
        $n  = $r ? $r->fetch_assoc()['c'] : 0;
        ok(['db' => 'mysql', 'users' => (int)$n]);
        break;

    case 'db':
        actionDb();
        break;

    case 'register':
        actionRegister($body);
        break;

    case 'login':
        actionLogin($body);
        break;

    case 'bio':
        actionBio($body);
        break;

    case 'avatar':
        actionAvatar($body);
        break;

    case 'friend':
        actionFriend($body);
        break;

    case 'game':
        actionGame($body);
        break;

    case 'game_delete':
        actionGameDelete($body);
        break;

    case 'game_visit':
        actionGameVisit($body);
        break;

    case 'game_vote':
        actionGameVote($body);
        break;

    case 'chat':
        actionChat($body);
        break;

    case 'dm':
        actionDm($body);
        break;

    case 'dm_summary':
        actionDmSummary($body);
        break;

    case 'presence':
        actionPresence($body);
        break;

    case 'presence_beat':
        actionPresenceBeat($body);
        break;

    case 'presence_leave':
        actionPresenceLeave($body);
        break;

    case 'ping':
        actionPing($body);
        break;

    case 'status':
        actionStatus();
        break;

    case 'join':
        actionJoin($body);
        break;

    case 'ban_check':
        actionBanCheck($body);
        break;

    case 'import':
        actionImport($body);
        break;

    case 'admin':
        actionAdmin($body);
        break;

    case 'stats':
        actionStats();
        break;

    default:
        err('Ação desconhecida: ' . htmlspecialchars($action), 400);
}

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════

function ok($data = []) {
    echo json_encode(array_merge(['ok' => true], $data));
    exit;
}

function err($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['err' => $msg]);
    exit;
}

function tryParse($str, $fallback = []) {
    $r = json_decode($str, true);
    return is_array($r) ? $r : $fallback;
}

function checkBanDb($db, $user_key, $hw, $dv) {
    $now = round(microtime(true) * 1000);
    $uk  = $db->real_escape_string($user_key ?? '');
    $hw2 = $db->real_escape_string($hw ?? '');
    $dv2 = $db->real_escape_string($dv ?? '');
    $r = $db->query("
        SELECT * FROM bans
        WHERE (until_ms = 0 OR until_ms > $now)
          AND (
            (user_key = '$uk')
            OR (hw IS NOT NULL AND hw = '$hw2')
            OR (dv IS NOT NULL AND dv = '$dv2')
          )
        LIMIT 1
    ");
    if (!$r || $r->num_rows === 0) return null;
    $b = $r->fetch_assoc();
    return [
        'text'  => $b['reason'] ?: 'Você foi banido.',
        'until' => $b['until_ms'] > 0 ? (int)$b['until_ms'] : null,
        'perm'  => $b['until_ms'] == 0
    ];
}

// ════════════════════════════════════════════════════════════
//  AÇÕES
// ════════════════════════════════════════════════════════════

function actionDb() {
    $db = getDb();
    $clientV = (int)($_GET['v'] ?? 0);

    $r = $db->query("
        SELECT GREATEST(
            COALESCE((SELECT MAX(last_seen_ms) FROM users), 0),
            COALESCE((SELECT MAX(updated_ms)   FROM games), 0)
        ) as last_ms
    ");
    $serverV = $r ? (int)$r->fetch_assoc()['last_ms'] : 0;

    if ($clientV > 0 && $clientV >= $serverV) {
        ok(['same' => true, 'v' => $serverV]);
    }

    $usersObj = [];
    $r = $db->query("
        SELECT username, username_key, bio,
               av_head, av_torso, av_arms, av_legs,
               verified, is_admin, is_owner,
               created_ms, last_seen_ms, id
        FROM users ORDER BY created_ms ASC
    ");
    if ($r) while ($u = $r->fetch_assoc()) {
        $usersObj[$u['username_key']] = [
            'name'         => $u['username'],
            'bio'          => $u['bio'] ?? '',
            'avatar'       => [
                'head'  => $u['av_head']  ?: '#f5cd30',
                'torso' => $u['av_torso'] ?: '#0d69ac',
                'arms'  => $u['av_arms']  ?: '#f5cd30',
                'legs'  => $u['av_legs']  ?: '#4b974b',
            ],
            'verified'     => (bool)$u['verified'],
            'admin'        => (bool)$u['is_admin'],
            'owner'        => (bool)$u['is_owner'],
            'created'      => (int)$u['created_ms'],
            'last_seen_ms' => (int)$u['last_seen_ms'],
            'id'           => (int)$u['id'],
        ];
    }

    // Jogos com JOIN para pegar o nome real do criador
    $gamesArr = [];
    $r = $db->query("
        SELECT g.*, u.username AS creator_username
        FROM games g
        LEFT JOIN users u ON u.username_key = g.creator_key
        ORDER BY g.created_ms DESC LIMIT 200
    ");
    if ($r) while ($g = $r->fetch_assoc()) {
        $gamesArr[] = [
            'name'        => $g['name'],
            'creator'     => $g['creator_username'] ?: $g['creator_key'],
            'description' => $g['description'] ?? '',
            'desc'        => $g['description'] ?? '',
            'serverSize'  => (int)$g['server_size'],
            'genre'       => $g['genre'] ?? 'Outro',
            'vip'         => (bool)$g['vip'],
            'visits'      => (int)$g['visits'],
            'blocks'      => (int)$g['blocks'],
            'parts'       => tryParse($g['parts']),
            'thumb'       => $g['thumb'] ?? '',
            'likes'       => tryParse($g['likes']),
            'dislikes'    => tryParse($g['dislikes']),
            'favs'        => tryParse($g['favs']),
            'created'     => (int)$g['created_ms'],
            'updated'     => (int)$g['updated_ms'],
        ];
    }

    // Amizades com nomes reais
    $friendsObj = [];
    $r = $db->query("SELECT * FROM friendships");
    if ($r) while ($f = $r->fetch_assoc()) {
        $nameA = $usersObj[$f['user_a']]['name'] ?? $f['user_a'];
        $nameB = $usersObj[$f['user_b']]['name'] ?? $f['user_b'];
        if (!isset($friendsObj[$f['user_a']])) $friendsObj[$f['user_a']] = [];
        if (!isset($friendsObj[$f['user_b']])) $friendsObj[$f['user_b']] = [];
        if (!in_array($nameB, $friendsObj[$f['user_a']])) $friendsObj[$f['user_a']][] = $nameB;
        if (!in_array($nameA, $friendsObj[$f['user_b']])) $friendsObj[$f['user_b']][] = $nameA;
    }

    // Pedidos de amizade com nomes reais
    $reqObj = [];
    $r = $db->query("SELECT * FROM friend_requests");
    if ($r) while ($req = $r->fetch_assoc()) {
        $fromName = $usersObj[$req['from_key']]['name'] ?? $req['from_key'];
        if (!isset($reqObj[$req['to_key']])) $reqObj[$req['to_key']] = [];
        if (!in_array($fromName, $reqObj[$req['to_key']])) $reqObj[$req['to_key']][] = $fromName;
    }

    ok([
        'db'    => ['users' => $usersObj, 'games' => $gamesArr, 'friends' => $friendsObj, 'req' => $reqObj, 'roles' => []],
        'v'     => $serverV ?: round(microtime(true) * 1000),
        'users' => count($usersObj),
    ]);
}

function actionRegister($b) {
    $db   = getDb();
    $name = trim($b['name'] ?? '');
    $email= trim($b['email'] ?? '');
    $hash = $b['hash'] ?? '';
    $hw   = $b['hw']   ?? '';
    $dv   = $b['dv']   ?? '';

    if (!$name || !$hash) err('Dados incompletos.');
    if (!preg_match('/^[A-Za-z0-9_]{3,20}$/', $name)) err('Usuário: 3 a 20 letras, números ou _ (sem espaços).');
    if ($email && !filter_var($email, FILTER_VALIDATE_EMAIL)) err('Digite um e-mail válido.');

    $ban = checkBanDb($db, strtolower($name), $hw, $dv);
    if ($ban) { http_response_code(403); echo json_encode(['err' => 'Conta banida.', 'ban' => $ban]); exit; }

    $usernameKey = $db->real_escape_string(strtolower($name));
    $usernameSafe= $db->real_escape_string($name);
    $hashSafe    = $db->real_escape_string($hash);
    $emailSafe   = $db->real_escape_string(strtolower($email));

    $r = $db->query("SELECT id FROM users WHERE username_key = '$usernameKey' LIMIT 1");
    if ($r && $r->num_rows > 0) {
        ok(['exists' => true]);
    }

    if ($email) {
        $r = $db->query("SELECT id FROM users WHERE email = '$emailSafe' LIMIT 1");
        if ($r && $r->num_rows > 0) err('Esse e-mail já está cadastrado.');
    }

    $r = $db->query("SELECT COUNT(*) as c FROM users");
    $isFirst = $r && (int)$r->fetch_assoc()['c'] === 0;
    $isAdmin = $isFirst ? 1 : 0;
    $isOwner = $isFirst ? 1 : 0;
    $now     = round(microtime(true) * 1000);

    $db->query("
        INSERT INTO users (username, username_key, email, password_hash, is_admin, is_owner, created_ms, last_seen_ms)
        VALUES ('$usernameSafe','$usernameKey','$emailSafe','$hashSafe',$isAdmin,$isOwner,$now,$now)
    ");
    if ($db->error) err('Erro ao registrar: ' . $db->error);

    if ($hw || $dv) {
        $hwS = $db->real_escape_string($hw);
        $dvS = $db->real_escape_string($dv);
        $ip  = $db->real_escape_string($_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '');
        $db->query("INSERT INTO user_devices (user_key, hw, dv, ip, last_ms) VALUES ('$usernameKey','$hwS','$dvS','$ip',$now)");
    }

    ok(['owner' => $isFirst]);
}

function actionLogin($b) {
    $db   = getDb();
    $name = trim($b['name'] ?? '');
    $hash = $b['hash'] ?? '';
    $hw   = $b['hw']   ?? '';
    $dv   = $b['dv']   ?? '';

    if (!$name || !$hash) err('Dados incompletos.');

    $uk = $db->real_escape_string(strtolower($name));

    $ban = checkBanDb($db, $uk, $hw, $dv);
    if ($ban) { http_response_code(403); echo json_encode(['err' => 'Conta banida.', 'ban' => $ban]); exit; }

    $r = $db->query("SELECT * FROM users WHERE username_key = '$uk' LIMIT 1");
    if (!$r || $r->num_rows === 0) err('Usuário ou senha incorretos.', 401);

    $user = $r->fetch_assoc();
    if ($user['password_hash'] !== $hash) err('Usuário ou senha incorretos.', 401);

    $now = round(microtime(true) * 1000);
    $db->query("UPDATE users SET last_seen_ms = $now WHERE username_key = '$uk'");

    if ($hw || $dv) {
        $hwS = $db->real_escape_string($hw);
        $dvS = $db->real_escape_string($dv);
        $ip  = $db->real_escape_string($_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '');
        $r2  = $db->query("SELECT id FROM user_devices WHERE user_key = '$uk' AND dv = '$dvS' LIMIT 1");
        if ($r2 && $r2->num_rows > 0) {
            $id = (int)$r2->fetch_assoc()['id'];
            $db->query("UPDATE user_devices SET last_ms = $now, ip = '$ip' WHERE id = $id");
        } else {
            $db->query("INSERT INTO user_devices (user_key, hw, dv, ip, last_ms) VALUES ('$uk','$hwS','$dvS','$ip',$now)");
        }
    }

    ok();
}

function actionBio($b) {
    $db   = getDb();
    $user = trim($b['user'] ?? '');
    $bio  = mb_substr(trim($b['bio'] ?? ''), 0, 300);
    if (!$user) err('Dados incompletos.');
    $uk  = $db->real_escape_string(strtolower($user));
    $bioS= $db->real_escape_string($bio);
    $db->query("UPDATE users SET bio = '$bioS' WHERE username_key = '$uk'");
    ok();
}

function actionAvatar($b) {
    $db  = getDb();
    $user= trim($b['user'] ?? '');
    $av  = $b['avatar'] ?? [];
    if (!$user) err('Dados incompletos.');
    $uk  = $db->real_escape_string(strtolower($user));
    $h   = $db->real_escape_string($av['head']  ?? '#f5cd30');
    $t   = $db->real_escape_string($av['torso'] ?? '#0d69ac');
    $a   = $db->real_escape_string($av['arms']  ?? '#f5cd30');
    $l   = $db->real_escape_string($av['legs']  ?? '#4b974b');
    $db->query("UPDATE users SET av_head='$h', av_torso='$t', av_arms='$a', av_legs='$l' WHERE username_key = '$uk'");
    ok();
}

function actionFriend($b) {
    $db    = getDb();
    $op    = $b['op']    ?? '';
    $me    = $b['me']    ?? '';
    $other = $b['other'] ?? '';
    if (!$op || !$me || !$other) err('Dados incompletos.');

    $meKey    = $db->real_escape_string(strtolower($me));
    $otherKey = $db->real_escape_string(strtolower($other));

    if ($op === 'request') {
        $db->query("INSERT IGNORE INTO friend_requests (from_key, to_key) VALUES ('$meKey', '$otherKey')");
    } elseif ($op === 'accept') {
        $db->query("DELETE FROM friend_requests WHERE from_key = '$otherKey' AND to_key = '$meKey'");
        $a = $meKey < $otherKey ? $meKey : $otherKey;
        $bk= $meKey < $otherKey ? $otherKey : $meKey;
        $db->query("INSERT IGNORE INTO friendships (user_a, user_b) VALUES ('$a', '$bk')");
    } elseif ($op === 'decline') {
        $db->query("DELETE FROM friend_requests WHERE from_key = '$otherKey' AND to_key = '$meKey'");
    } elseif ($op === 'unfriend') {
        $a = $meKey < $otherKey ? $meKey : $otherKey;
        $bk= $meKey < $otherKey ? $otherKey : $meKey;
        $db->query("DELETE FROM friendships WHERE user_a = '$a' AND user_b = '$bk'");
    }

    ok();
}

function actionGame($b) {
    $db  = getDb();
    $creator = $b['creator'] ?? '';
    $game    = $b['game']    ?? [];
    if (!$creator || !($game['name'] ?? '')) err('Dados do jogo incompletos.');

    $ck   = $db->real_escape_string(strtolower($creator));
    $name = $db->real_escape_string($game['name']);
    $desc = $db->real_escape_string($game['description'] ?? '');
    $size = (int)($game['serverSize'] ?? 20);
    $genre= $db->real_escape_string($game['genre'] ?? 'Outro');
    $vip  = $game['vip'] ? 1 : 0;
    $blks = (int)($game['blocks'] ?? 0);
    $parts= $db->real_escape_string(json_encode($game['parts'] ?? []));
    $thumb= $db->real_escape_string($game['thumb'] ?? '');
    $likes= $db->real_escape_string(json_encode($game['likes'] ?? []));
    $disls= $db->real_escape_string(json_encode($game['dislikes'] ?? []));
    $favs = $db->real_escape_string(json_encode($game['favs'] ?? []));
    $now  = round(microtime(true) * 1000);
    $created = (int)($game['created'] ?? $now);

    $r = $db->query("SELECT id FROM games WHERE creator_key = '$ck' AND name = '$name' LIMIT 1");
    if ($r && $r->num_rows > 0) {
        $db->query("
            UPDATE games SET
                description = '$desc', server_size = $size, genre = '$genre',
                vip = $vip, blocks = $blks, parts = '$parts', thumb = '$thumb',
                updated_ms = $now
            WHERE creator_key = '$ck' AND name = '$name'
        ");
    } else {
        $db->query("
            INSERT INTO games
              (creator_key, name, description, server_size, genre, vip, blocks, parts, thumb, likes, dislikes, favs, created_ms, updated_ms)
            VALUES
              ('$ck','$name','$desc',$size,'$genre',$vip,$blks,'$parts','$thumb','$likes','$disls','$favs',$created,$now)
        ");
    }
    if ($db->error) err('Erro ao salvar jogo: ' . $db->error);
    ok();
}

function actionGameDelete($b) {
    $db      = getDb();
    $name    = $b['name']    ?? '';
    $creator = $b['creator'] ?? '';
    if (!$name || !$creator) err('Dados incompletos.');
    $n  = $db->real_escape_string($name);
    $ck = $db->real_escape_string(strtolower($creator));
    $db->query("DELETE FROM games WHERE name = '$n' AND creator_key = '$ck'");
    ok();
}

function actionGameVisit($b) {
    $db      = getDb();
    $name    = $b['name']    ?? '';
    $creator = $b['creator'] ?? '';
    if (!$name || !$creator) err('Dados incompletos.');
    $n  = $db->real_escape_string($name);
    $ck = $db->real_escape_string(strtolower($creator));
    $db->query("UPDATE games SET visits = visits + 1 WHERE name = '$n' AND creator_key = '$ck'");
    ok();
}

function actionGameVote($b) {
    $db      = getDb();
    $name    = $b['name']    ?? '';
    $creator = $b['creator'] ?? '';
    $user    = $b['user']    ?? '';
    $kind    = $b['kind']    ?? '';
    if (!$name || !$creator || !$user || !$kind) err('Dados incompletos.');

    $n  = $db->real_escape_string($name);
    $ck = $db->real_escape_string(strtolower($creator));

    $r = $db->query("SELECT likes, dislikes, favs FROM games WHERE name = '$n' AND creator_key = '$ck' LIMIT 1");
    if (!$r || $r->num_rows === 0) err('Jogo não encontrado.');
    $g = $r->fetch_assoc();

    $likes    = tryParse($g['likes']);
    $dislikes = tryParse($g['dislikes']);
    $favs     = tryParse($g['favs']);
    $me       = strtolower($user);

    $removeFrom = function(&$arr) use ($me) {
        $arr = array_values(array_filter($arr, fn($u) => strtolower($u) !== $me));
    };

    if ($kind === 'like' || $kind === 'dislike') {
        $had = in_array($me, array_map('strtolower', $kind === 'like' ? $likes : $dislikes));
        $removeFrom($likes);
        $removeFrom($dislikes);
        if (!$had) {
            if ($kind === 'like') $likes[] = $user;
            else $dislikes[] = $user;
        }
    } elseif ($kind === 'fav') {
        $had = in_array($me, array_map('strtolower', $favs));
        $removeFrom($favs);
        if (!$had) $favs[] = $user;
    }

    $lS = $db->real_escape_string(json_encode($likes));
    $dS = $db->real_escape_string(json_encode($dislikes));
    $fS = $db->real_escape_string(json_encode($favs));
    $db->query("UPDATE games SET likes='$lS', dislikes='$dS', favs='$fS' WHERE name='$n' AND creator_key='$ck'");
    ok();
}

function actionChat($b) {
    $db     = getDb();
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'POST') {
        $map  = $b['map']  ?? '';
        $user = $b['user'] ?? '';
        $msg  = mb_substr(trim($b['msg'] ?? ''), 0, 200);
        if (!$map || !$user || !$msg) err('Dados incompletos.');
        $mk   = $db->real_escape_string($map);
        $uk   = $db->real_escape_string(strtolower($user));
        $msgS = $db->real_escape_string($msg);
        $now  = round(microtime(true) * 1000);
        $db->query("INSERT INTO map_chat (map_key, user_key, msg, sent_ms) VALUES ('$mk','$uk','$msgS',$now)");
        $db->query("
            DELETE FROM map_chat WHERE map_key = '$mk'
            AND id NOT IN (SELECT id FROM (SELECT id FROM map_chat WHERE map_key = '$mk' ORDER BY id DESC LIMIT 60) t)
        ");
        ok();
    } else {
        $map   = $_GET['map']   ?? '';
        $after = (int)($_GET['after'] ?? 0);
        if (!$map) err('map obrigatório.');
        $mk = $db->real_escape_string($map);
        $r  = $db->query("SELECT * FROM map_chat WHERE map_key = '$mk' AND id > $after ORDER BY id ASC LIMIT 60");
        $msgs = [];
        if ($r) while ($row = $r->fetch_assoc()) {
            $msgs[] = ['id' => (int)$row['id'], 'u' => $row['user_key'], 'm' => $row['msg'], 't' => (int)$row['sent_ms']];
        }
        $last = count($msgs) ? (int)end($msgs)['id'] : $after;
        ok(['msgs' => $msgs, 'last' => $last]);
    }
}

function actionDm($b) {
    $db     = getDb();
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'POST') {
        $from  = $b['from']  ?? '';
        $to    = $b['to']    ?? '';
        $msg   = mb_substr(trim($b['msg'] ?? ''), 0, 500);
        $reply = $b['reply'] ?? null;
        if (!$from || !$to || !$msg) err('Dados incompletos.');
        $fk  = $db->real_escape_string(strtolower($from));
        $tk  = $db->real_escape_string(strtolower($to));
        $mS  = $db->real_escape_string($msg);
        $now = round(microtime(true) * 1000);
        $ru  = $db->real_escape_string($reply['u'] ?? '');
        $rm  = $db->real_escape_string(mb_substr($reply['m'] ?? '', 0, 100));
        $rt  = (int)($reply['t'] ?? 0);
        if ($ru) {
            $db->query("INSERT INTO messages (sender_key, receiver_key, body, reply_user, reply_text, reply_ms, sent_ms) VALUES ('$fk','$tk','$mS','$ru','$rm',$rt,$now)");
        } else {
            $db->query("INSERT INTO messages (sender_key, receiver_key, body, sent_ms) VALUES ('$fk','$tk','$mS',$now)");
        }
        ok();
    } else {
        $me    = $_GET['me']    ?? '';
        $other = $_GET['other'] ?? '';
        $read  = ($_GET['read'] ?? '') === '1';
        if (!$me || !$other) err('Dados incompletos.');
        $mk  = $db->real_escape_string(strtolower($me));
        $ok2 = $db->real_escape_string(strtolower($other));
        $now = round(microtime(true) * 1000);

        $r = $db->query("
            SELECT * FROM messages
            WHERE (sender_key = '$mk' AND receiver_key = '$ok2')
               OR (sender_key = '$ok2' AND receiver_key = '$mk')
            ORDER BY sent_ms ASC LIMIT 300
        ");
        $msgs = [];
        if ($r) while ($row = $r->fetch_assoc()) {
            $m = ['u' => $row['sender_key'], 'm' => $row['body'], 't' => (int)$row['sent_ms']];
            if ($row['reply_user']) $m['r'] = ['u' => $row['reply_user'], 'm' => $row['reply_text'], 't' => (int)$row['reply_ms']];
            $msgs[] = $m;
        }

        $r2 = $db->query("SELECT last_seen_ms FROM users WHERE username_key = '$ok2' LIMIT 1");
        $otherSeen = $r2 ? (int)$r2->fetch_assoc()['last_seen_ms'] : 0;
        $r3 = $db->query("SELECT read_ms FROM dm_reads WHERE user_key = '$ok2' AND other_key = '$mk' LIMIT 1");
        $otherRead = $r3 && $r3->num_rows ? (int)$r3->fetch_assoc()['read_ms'] : 0;

        if ($read && count($msgs)) {
            $lastT = end($msgs)['t'];
            $db->query("
                INSERT INTO dm_reads (user_key, other_key, read_ms) VALUES ('$mk','$ok2',$lastT)
                ON DUPLICATE KEY UPDATE read_ms = GREATEST(read_ms, $lastT)
            ");
        }

        ok(['msgs' => $msgs, 'st' => [
            'r'      => $otherRead,
            's'      => $otherSeen,
            'online' => ($now - $otherSeen) < 12000,
        ]]);
    }
}

function actionDmSummary($b) {
    $db = getDb();
    $me = $_GET['me'] ?? $b['me'] ?? '';
    if (!$me) err('me obrigatório.');
    $mk = $db->real_escape_string(strtolower($me));

    $r   = $db->query("
        SELECT * FROM messages
        WHERE sender_key = '$mk' OR receiver_key = '$mk'
        ORDER BY sent_ms DESC
    ");
    $seen = [];
    $out  = [];
    if ($r) while ($row = $r->fetch_assoc()) {
        $other = $row['sender_key'] === $mk ? $row['receiver_key'] : $row['sender_key'];
        if (isset($seen[$other])) continue;
        $seen[$other] = true;
        $out[$other]  = ['u' => $row['sender_key'], 'm' => $row['body'], 't' => (int)$row['sent_ms']];
    }
    ok($out);
}

function actionPresence($b) {
    $db  = getDb();
    $TTL = 75000;
    $now = round(microtime(true) * 1000);
    $db->query("DELETE FROM presence WHERE last_ms < " . ($now - $TTL));
    $r = $db->query("SELECT user_key, map_key FROM presence WHERE last_ms > " . ($now - $TTL));
    $out = [];
    if ($r) while ($row = $r->fetch_assoc()) {
        $k = $row['map_key'] ?? '';
        if (!$k) continue;
        if (!isset($out[$k])) $out[$k] = [];
        $out[$k][] = $row['user_key'];
    }
    ok($out);
}

function actionPresenceBeat($b) {
    $db  = getDb();
    $map = $b['map']  ?? '';
    $user= $b['user'] ?? '';
    if (!$map || !$user) err('Dados incompletos.');
    $mk  = $db->real_escape_string($map);
    $uk  = $db->real_escape_string(strtolower($user));
    $now = round(microtime(true) * 1000);
    $db->query("
        INSERT INTO presence (user_key, map_key, last_ms)
        VALUES ('$uk','$mk',$now)
        ON DUPLICATE KEY UPDATE map_key='$mk', last_ms=$now
    ");
    ok();
}

function actionPresenceLeave($b) {
    $db  = getDb();
    $map = $b['map']  ?? '';
    $user= $b['user'] ?? '';
    if (!$map || !$user) err('Dados incompletos.');
    $mk = $db->real_escape_string($map);
    $uk = $db->real_escape_string(strtolower($user));
    $db->query("DELETE FROM presence WHERE user_key = '$uk' AND map_key = '$mk'");
    ok();
}

function actionPing($b) {
    $db   = getDb();
    $user = $b['user'] ?? '';
    $hw   = $b['hw']   ?? '';
    $dv   = $b['dv']   ?? '';
    if (!$user) err('user obrigatório.');
    $uk  = $db->real_escape_string(strtolower($user));
    $now = round(microtime(true) * 1000);
    $db->query("UPDATE users SET last_seen_ms = $now WHERE username_key = '$uk'");
    $ban = checkBanDb($db, $uk, $hw, $dv);
    if ($ban) { echo json_encode(['ok' => true, 'ban' => $ban]); exit; }
    ok();
}

function actionStatus() {
    $db   = getDb();
    $me   = $_GET['me']    ?? '';
    $usrs = $_GET['users'] ?? '';
    if (!$me || !$usrs) ok([]);
    $TTL  = 75000;
    $now  = round(microtime(true) * 1000);
    $names= array_filter(array_map('trim', explode(',', $usrs)));
    if (!count($names)) ok([]);
    $meKey= $db->real_escape_string(strtolower($me));

    $frR = $db->query("SELECT user_a, user_b FROM friendships WHERE user_a = '$meKey' OR user_b = '$meKey'");
    $friends = [];
    if ($frR) while ($f = $frR->fetch_assoc()) {
        $other = $f['user_a'] === $meKey ? $f['user_b'] : $f['user_a'];
        $friends[$other] = true;
    }

    $out = [];
    foreach ($names as $name) {
        $uk  = strtolower($name);
        $ukS = $db->real_escape_string($uk);
        $r   = $db->query("SELECT last_seen_ms FROM users WHERE username_key = '$ukS' LIMIT 1");
        if (!$r || $r->num_rows === 0) continue;
        $seen   = (int)$r->fetch_assoc()['last_seen_ms'];
        $online = ($now - $seen) < 12000;
        $map    = null;
        if ($online && isset($friends[$uk])) {
            $p = $db->query("SELECT map_key FROM presence WHERE user_key = '$ukS' LIMIT 1");
            if ($p && $p->num_rows) {
                $mk = $p->fetch_assoc()['map_key'] ?? '';
                if ($mk) $map = preg_replace('/#\d+$/', '', $mk);
            }
        }
        $out[$uk] = ['on' => $online, 's' => $seen, 'g' => $map];
    }
    ok($out);
}

function actionJoin($b) {
    $db   = getDb();
    $op   = $b['op']   ?? 'join';
    $base = $b['base'] ?? '';
    $user = $b['user'] ?? '';
    $size = (int)($b['size'] ?? 20);
    $tab  = $b['tab']  ?? '';
    $TTL  = 75000;
    $now  = round(microtime(true) * 1000);

    if (!$base || !$user) err('Dados incompletos.');
    $uk = $db->real_escape_string(strtolower($user));

    if ($op === 'join') {
        $baseS = $db->real_escape_string($base);
        $r = $db->query("
            SELECT map_key FROM presence
            WHERE user_key = '$uk' AND map_key LIKE '$baseS#%' AND last_ms > " . ($now - $TTL) . "
            LIMIT 1
        ");
        if ($r && $r->num_rows > 0) {
            $existing    = $r->fetch_assoc()['map_key'];
            $tabR        = $db->query("SELECT tab_id FROM presence WHERE user_key = '$uk' LIMIT 1");
            $existingTab = $tabR && $tabR->num_rows ? $tabR->fetch_assoc()['tab_id'] : '';
            if ($existingTab && $existingTab !== $tab) {
                ok(['busy' => true]);
            }
        }
        $idx = 0;
        for ($i = 0; $i < 50; $i++) {
            $mk  = $db->real_escape_string($base . '#' . $i);
            $c   = $db->query("SELECT COUNT(*) as c FROM presence WHERE map_key = '$mk' AND last_ms > " . ($now - $TTL));
            $cnt = $c ? (int)$c->fetch_assoc()['c'] : 0;
            if ($cnt < $size) { $idx = $i; break; }
        }
        ok(['idx' => $idx]);
    } elseif ($op === 'refresh') {
        $tabS = $db->real_escape_string($tab);
        $db->query("UPDATE presence SET last_ms = $now, tab_id = '$tabS' WHERE user_key = '$uk'");
        ok();
    } elseif ($op === 'release') {
        $db->query("DELETE FROM presence WHERE user_key = '$uk'");
        ok();
    }
    ok();
}

function actionBanCheck($b) {
    $db  = getDb();
    $user= $b['user'] ?? '';
    $hw  = $b['hw']   ?? '';
    $dv  = $b['dv']   ?? '';
    $ban = checkBanDb($db, strtolower($user), $hw, $dv);
    if ($ban) { echo json_encode(['ban' => $ban]); exit; }
    ok();
}

function actionImport($b) {
    $db    = getDb();
    $users = $b['users'] ?? [];
    foreach ($users as $key => $u) {
        $uk  = $db->real_escape_string(strtolower($key));
        $un  = $db->real_escape_string($u['name'] ?? $key);
        $em  = $db->real_escape_string(strtolower($u['email'] ?? ''));
        $hs  = $db->real_escape_string($u['hash'] ?? '');
        $now = round(microtime(true) * 1000);
        if (!$hs) continue;
        $db->query("INSERT IGNORE INTO users (username, username_key, email, password_hash, created_ms, last_seen_ms) VALUES ('$un','$uk','$em','$hs',$now,$now)");
    }
    ok();
}

function actionStats() {
    $db  = getDb();
    $TTL = 75000;
    $now = round(microtime(true) * 1000);
    $r1  = $db->query("SELECT COUNT(*) as c FROM users");
    $r2  = $db->query("SELECT COUNT(*) as c FROM games");
    $r3  = $db->query("SELECT COALESCE(SUM(visits),0) as c FROM games");
    $r4  = $db->query("SELECT COUNT(*) as c FROM presence WHERE last_ms > " . ($now - $TTL));
    ok([
        'totalUsers' => $r1 ? (int)$r1->fetch_assoc()['c'] : 0,
        'totalGames' => $r2 ? (int)$r2->fetch_assoc()['c'] : 0,
        'totalViews' => $r3 ? (int)$r3->fetch_assoc()['c'] : 0,
        'online'     => $r4 ? (int)$r4->fetch_assoc()['c'] : 0,
    ]);
}

function actionAdmin($b) {
    $db   = getDb();
    $user = $b['user'] ?? '';
    $hash = $b['hash'] ?? '';
    $op   = $b['op']   ?? '';

    if (!$user || !$hash) err('Credenciais obrigatórias.', 403);
    $uk = $db->real_escape_string(strtolower($user));
    $hs = $db->real_escape_string($hash);
    $r  = $db->query("SELECT * FROM users WHERE username_key = '$uk' AND password_hash = '$hs' LIMIT 1");
    if (!$r || $r->num_rows === 0) err('Acesso negado.', 403);
    $admin = $r->fetch_assoc();
    if (!$admin['is_admin'] && !$admin['is_owner']) err('Acesso negado.', 403);

    if ($op === 'list') { ok(buildAdminList($db, $admin)); }

    if ($op === 'verify') {
        $target = $db->real_escape_string(strtolower($b['target'] ?? ''));
        $on     = $b['on'] ? 1 : 0;
        $db->query("UPDATE users SET verified = $on WHERE username_key = '$target'");
        ok(buildAdminList($db, $admin));
    }

    if ($op === 'admin') {
        if (!$admin['is_owner']) err('Apenas o owner pode alterar admins.', 403);
        $target = $db->real_escape_string(strtolower($b['target'] ?? ''));
        $on     = $b['on'] ? 1 : 0;
        if ($target === $uk && !$on) err('Você não pode remover seu próprio admin.');
        $db->query("UPDATE users SET is_admin = $on WHERE username_key = '$target'");
        ok(buildAdminList($db, $admin));
    }

    if ($op === 'ban') {
        $banType = $db->real_escape_string($b['type'] ?? 'user');
        $target  = $b['target'] ?? '';
        $reason  = $db->real_escape_string($b['reason'] ?? '');
        $until   = (int)($b['until_ms'] ?? 0);
        $hw2     = $db->real_escape_string($b['hw'] ?? '');
        $dv2     = $db->real_escape_string($b['dv'] ?? '');
        $ip2     = $db->real_escape_string($b['ip'] ?? '');
        $by      = $db->real_escape_string($admin['username']);
        $now     = round(microtime(true) * 1000);
        $tk      = $db->real_escape_string(strtolower($target));
        $tn      = $db->real_escape_string($target);
        $hwVal   = $hw2 ? "'$hw2'" : "NULL";
        $dvVal   = $dv2 ? "'$dv2'" : "NULL";
        $ipVal   = $ip2 ? "'$ip2'" : "NULL";
        $db->query("INSERT INTO bans (type, user_key, username, hw, dv, ip, reason, until_ms, created_ms, by_name) VALUES ('$banType','$tk','$tn',$hwVal,$dvVal,$ipVal,'$reason',$until,$now,'$by')");
        ok(buildAdminList($db, $admin));
    }

    if ($op === 'unban') {
        $id = (int)($b['id'] ?? 0);
        $db->query("DELETE FROM bans WHERE id = $id");
        ok(buildAdminList($db, $admin));
    }

    if ($op === 'delete_user') {
        if (!$admin['is_owner']) err('Apenas o owner pode excluir usuários.', 403);
        $target = $db->real_escape_string(strtolower($b['target'] ?? ''));
        $db->query("DELETE FROM users WHERE username_key = '$target'");
        ok(buildAdminList($db, $admin));
    }

    if ($op === 'delete_game') {
        $gname   = $db->real_escape_string($b['name']    ?? '');
        $creator = $db->real_escape_string(strtolower($b['creator'] ?? ''));
        $db->query("DELETE FROM games WHERE name = '$gname' AND creator_key = '$creator'");
        ok(buildAdminList($db, $admin));
    }

    err('Operação inválida: ' . htmlspecialchars($op));
}

function buildAdminList($db, $admin) {
    $users  = $db->query("SELECT * FROM users ORDER BY created_ms ASC");
    $games  = $db->query("SELECT * FROM games ORDER BY created_ms DESC");
    $bans   = $db->query("SELECT * FROM bans ORDER BY created_ms DESC");

    $gamesByUser = [];
    if ($games) while ($g = $games->fetch_assoc()) {
        $ck = $g['creator_key'];
        if (!isset($gamesByUser[$ck])) $gamesByUser[$ck] = [];
        $gamesByUser[$ck][] = $g;
    }

    $usersOut = [];
    if ($users) while ($u = $users->fetch_assoc()) {
        $uk  = $u['username_key'];
        $ugs = $gamesByUser[$uk] ?? [];
        $usersOut[] = [
            'name'     => $u['username'],
            'key'      => $uk,
            'email'    => $u['email'],
            'bio'      => $u['bio'],
            'avatar'   => ['head' => $u['av_head'], 'torso' => $u['av_torso'], 'arms' => $u['av_arms'], 'legs' => $u['av_legs']],
            'verified' => (bool)$u['verified'],
            'admin'    => (bool)$u['is_admin'],
            'owner'    => (bool)$u['is_owner'],
            'created'  => (int)$u['created_ms'],
            'lastSeen' => (int)$u['last_seen_ms'],
            'games'    => array_map(fn($g) => ['name' => $g['name'], 'visits' => (int)$g['visits']], $ugs),
        ];
    }

    $bansOut = [];
    if ($bans) while ($b = $bans->fetch_assoc()) $bansOut[] = $b;

    return ['users' => $usersOut, 'bans' => $bansOut, 'roles' => [], 'isOwner' => (bool)$admin['is_owner']];
}

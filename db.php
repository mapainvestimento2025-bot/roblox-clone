<?php
// ============================================================
//  db.php — Configuração do banco MySQL (ProFreeHost)
//
//  IMPORTANTE: Edite as 4 linhas abaixo com suas credenciais
//  do ProFreeHost ANTES de fazer o upload para o servidor.
//
//  Depois do upload no ProFreeHost, acesse:
//  https://brplaybox.unaux.com/api.php?action=health
//  Deve retornar: {"ok":true,"db":"mysql","users":0}
// ============================================================

define('DB_HOST', 'localhost');           // Sempre 'localhost' no ProFreeHost
define('DB_USER', 'SEU_USUARIO_MYSQL');   // Ex: id123456_admin
define('DB_PASS', 'SUA_SENHA_MYSQL');     // Senha do usuário MySQL
define('DB_NAME', 'SEU_BANCO_MYSQL');     // Ex: id123456_roblox

define('DB_CHARSET', 'utf8mb4');

$_globalDb = null;

function getDb() {
    global $_globalDb;
    if ($_globalDb) return $_globalDb;

    $_globalDb = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);

    if ($_globalDb->connect_error) {
        http_response_code(500);
        echo json_encode([
            'err' => 'Falha na conexão com o banco de dados. ' .
                     'Verifique DB_USER, DB_PASS e DB_NAME no arquivo db.php. ' .
                     'Erro: ' . $_globalDb->connect_error
        ]);
        exit;
    }

    $_globalDb->set_charset(DB_CHARSET);
    ensureTables($_globalDb);

    return $_globalDb;
}

function ensureTables($db) {
    $queries = [

        "CREATE TABLE IF NOT EXISTS `users` (
            `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `username`      VARCHAR(20)  NOT NULL,
            `username_key`  VARCHAR(20)  NOT NULL,
            `email`         VARCHAR(120) NOT NULL DEFAULT '',
            `password_hash` VARCHAR(128) NOT NULL,
            `bio`           VARCHAR(300) NOT NULL DEFAULT '',
            `av_head`       CHAR(7)  NULL,
            `av_torso`      CHAR(7)  NULL,
            `av_arms`       CHAR(7)  NULL,
            `av_legs`       CHAR(7)  NULL,
            `verified`      TINYINT(1) NOT NULL DEFAULT 0,
            `is_admin`      TINYINT(1) NOT NULL DEFAULT 0,
            `is_owner`      TINYINT(1) NOT NULL DEFAULT 0,
            `created_ms`    BIGINT UNSIGNED NOT NULL,
            `last_seen_ms`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
            PRIMARY KEY (`id`),
            UNIQUE KEY `uq_username`     (`username`),
            UNIQUE KEY `uq_username_key` (`username_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS `games` (
            `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `creator_key` VARCHAR(20)  NOT NULL,
            `name`        VARCHAR(40)  NOT NULL,
            `description` VARCHAR(400) NOT NULL DEFAULT '',
            `server_size` SMALLINT UNSIGNED NOT NULL DEFAULT 20,
            `genre`       VARCHAR(30)  NOT NULL DEFAULT 'Outro',
            `vip`         TINYINT(1)   NOT NULL DEFAULT 0,
            `visits`      INT UNSIGNED NOT NULL DEFAULT 0,
            `blocks`      INT UNSIGNED NOT NULL DEFAULT 0,
            `parts`       LONGTEXT     NOT NULL,
            `thumb`       MEDIUMTEXT   NULL,
            `likes`       TEXT         NOT NULL DEFAULT '[]',
            `dislikes`    TEXT         NOT NULL DEFAULT '[]',
            `favs`        TEXT         NOT NULL DEFAULT '[]',
            `created_ms`  BIGINT UNSIGNED NOT NULL,
            `updated_ms`  BIGINT UNSIGNED NOT NULL,
            PRIMARY KEY (`id`),
            UNIQUE KEY `uq_game` (`creator_key`, `name`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS `friendships` (
            `user_a` VARCHAR(20) NOT NULL,
            `user_b` VARCHAR(20) NOT NULL,
            PRIMARY KEY (`user_a`, `user_b`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS `friend_requests` (
            `from_key` VARCHAR(20) NOT NULL,
            `to_key`   VARCHAR(20) NOT NULL,
            PRIMARY KEY (`from_key`, `to_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS `messages` (
            `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `sender_key`   VARCHAR(20) NOT NULL,
            `receiver_key` VARCHAR(20) NOT NULL,
            `body`         VARCHAR(500) NOT NULL,
            `reply_user`   VARCHAR(40)  NULL,
            `reply_text`   VARCHAR(100) NULL,
            `reply_ms`     BIGINT UNSIGNED NULL,
            `sent_ms`      BIGINT UNSIGNED NOT NULL,
            PRIMARY KEY (`id`),
            KEY `ix_pair` (`sender_key`, `receiver_key`, `sent_ms`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS `dm_reads` (
            `user_key`  VARCHAR(20) NOT NULL,
            `other_key` VARCHAR(20) NOT NULL,
            `read_ms`   BIGINT UNSIGNED NOT NULL,
            PRIMARY KEY (`user_key`, `other_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS `bans` (
            `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `type`       VARCHAR(10)  NOT NULL DEFAULT 'user',
            `user_key`   VARCHAR(20)  NULL,
            `username`   VARCHAR(20)  NULL,
            `email`      VARCHAR(120) NULL,
            `hw`         TEXT NULL,
            `dv`         TEXT NULL,
            `ip`         TEXT NULL,
            `reason`     VARCHAR(300) NOT NULL DEFAULT '',
            `until_ms`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
            `created_ms` BIGINT UNSIGNED NOT NULL,
            `by_name`    VARCHAR(20)  NULL,
            `amount`     SMALLINT UNSIGNED NULL,
            `unit`       VARCHAR(10)  NULL,
            PRIMARY KEY (`id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS `user_devices` (
            `id`       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `user_key` VARCHAR(20) NOT NULL,
            `hw`       VARCHAR(64) NULL,
            `dv`       VARCHAR(64) NULL,
            `ip`       VARCHAR(64) NULL,
            `last_ms`  BIGINT UNSIGNED NOT NULL,
            PRIMARY KEY (`id`),
            KEY `ix_dev_user` (`user_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS `map_chat` (
            `id`       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            `map_key`  VARCHAR(200) NOT NULL,
            `user_key` VARCHAR(20)  NOT NULL,
            `msg`      VARCHAR(200) NOT NULL,
            `sent_ms`  BIGINT UNSIGNED NOT NULL,
            PRIMARY KEY (`id`),
            KEY `ix_map_chat` (`map_key`, `sent_ms`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

        "CREATE TABLE IF NOT EXISTS `presence` (
            `user_key` VARCHAR(20)  NOT NULL,
            `map_key`  VARCHAR(200) NULL,
            `tab_id`   VARCHAR(64)  NULL,
            `last_ms`  BIGINT UNSIGNED NOT NULL,
            PRIMARY KEY (`user_key`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

    ];

    foreach ($queries as $q) {
        $db->query($q);
    }
}

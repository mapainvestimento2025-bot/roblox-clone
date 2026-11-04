-- ============================================================
--  Roblox Clone - banco de dados (MySQL / MariaDB - XAMPP)
--  O server.js cria tudo isto sozinho na primeira vez que roda.
--  Se preferir, importe este arquivo no phpMyAdmin (aba "Importar").
-- ============================================================
CREATE DATABASE IF NOT EXISTS `roblox_clone` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `roblox_clone`;

-- Usuários: cada conta tem um ID único (id)
CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(20)  NOT NULL,
  `email`         VARCHAR(120) NOT NULL,
  `password_hash` VARCHAR(128) NOT NULL,
  `bio`           VARCHAR(300) NOT NULL DEFAULT '',
  `av_head`       CHAR(7) NULL, `av_torso` CHAR(7) NULL, `av_arms` CHAR(7) NULL, `av_legs` CHAR(7) NULL,
  `verified`      TINYINT(1) NOT NULL DEFAULT 0,
  `is_admin`      TINYINT(1) NOT NULL DEFAULT 0,
  `created_ms`    BIGINT UNSIGNED NOT NULL,
  `last_seen_ms`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`    DATETIME GENERATED ALWAYS AS (FROM_UNIXTIME(`created_ms` / 1000)) VIRTUAL,
  `last_seen`     DATETIME GENERATED ALWAYS AS (IF(`last_seen_ms` = 0, NULL, FROM_UNIXTIME(`last_seen_ms` / 1000))) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_username` (`username`),
  UNIQUE KEY `uq_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Mapas publicados no Studio
CREATE TABLE IF NOT EXISTS `games` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `creator_id`  INT UNSIGNED NOT NULL,
  `name`        VARCHAR(40)  NOT NULL,
  `description` VARCHAR(400) NOT NULL DEFAULT '',
  `server_size` SMALLINT UNSIGNED NOT NULL DEFAULT 20,
  `genre`       VARCHAR(30)  NOT NULL DEFAULT 'Outro',
  `vip`         TINYINT(1)   NOT NULL DEFAULT 0,
  `visits`      INT UNSIGNED NOT NULL DEFAULT 0,
  `blocks`      INT UNSIGNED NOT NULL DEFAULT 0,
  `parts`       LONGTEXT     NOT NULL,
  `thumb`       MEDIUMTEXT   NULL,
  `created_ms`  BIGINT UNSIGNED NOT NULL,
  `updated_ms`  BIGINT UNSIGNED NOT NULL,
  `created_at`  DATETIME GENERATED ALWAYS AS (FROM_UNIXTIME(`created_ms` / 1000)) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_game` (`creator_id`, `name`),
  CONSTRAINT `fk_game_creator` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Curtidas, não curtidas e favoritos (um por conta)
CREATE TABLE IF NOT EXISTS `game_votes` (
  `game_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `kind`    ENUM('like','dislike','fav') NOT NULL,
  PRIMARY KEY (`game_id`, `user_id`, `kind`),
  CONSTRAINT `fk_vote_game` FOREIGN KEY (`game_id`) REFERENCES `games` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_vote_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Amizades (uma linha por par, user_a < user_b)
CREATE TABLE IF NOT EXISTS `friendships` (
  `user_a` INT UNSIGNED NOT NULL,
  `user_b` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`user_a`, `user_b`),
  CONSTRAINT `fk_fr_a` FOREIGN KEY (`user_a`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fr_b` FOREIGN KEY (`user_b`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pedidos de amizade pendentes
CREATE TABLE IF NOT EXISTS `friend_requests` (
  `from_id` INT UNSIGNED NOT NULL,
  `to_id`   INT UNSIGNED NOT NULL,
  PRIMARY KEY (`from_id`, `to_id`),
  CONSTRAINT `fk_rq_from` FOREIGN KEY (`from_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rq_to` FOREIGN KEY (`to_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Mensagens do bate-papo entre amigos
CREATE TABLE IF NOT EXISTS `messages` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sender_id`   INT UNSIGNED NOT NULL,
  `receiver_id` INT UNSIGNED NOT NULL,
  `body`        VARCHAR(500) NOT NULL,
  `reply_user`  VARCHAR(40)  NULL,
  `reply_text`  VARCHAR(100) NULL,
  `reply_ms`    BIGINT UNSIGNED NULL,
  `sent_ms`     BIGINT UNSIGNED NOT NULL,
  `sent_at`     DATETIME GENERATED ALWAYS AS (FROM_UNIXTIME(`sent_ms` / 1000)) VIRTUAL,
  PRIMARY KEY (`id`),
  KEY `ix_pair` (`sender_id`, `receiver_id`, `sent_ms`),
  CONSTRAINT `fk_msg_s` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_msg_r` FOREIGN KEY (`receiver_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Até quando cada pessoa leu a conversa com cada amigo (selos azuis)
CREATE TABLE IF NOT EXISTS `dm_reads` (
  `user_id`  INT UNSIGNED NOT NULL,
  `other_id` INT UNSIGNED NOT NULL,
  `read_ms`  BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`user_id`, `other_id`),
  CONSTRAINT `fk_rd_u` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rd_o` FOREIGN KEY (`other_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Banimentos: hwid (dispositivo), email, temp (horas/dias) e perm (conta excluída; e-mail bloqueado)
CREATE TABLE IF NOT EXISTS `bans` (
  `id`         INT UNSIGNED NOT NULL,
  `type`       ENUM('hwid','email','temp','perm') NOT NULL,
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
  `until_at`   DATETIME GENERATED ALWAYS AS (IF(`until_ms` = 0, NULL, FROM_UNIXTIME(`until_ms` / 1000))) VIRTUAL,
  `created_at` DATETIME GENERATED ALWAYS AS (FROM_UNIXTIME(`created_ms` / 1000)) VIRTUAL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dispositivos já usados por cada conta (identificação para o ban por HWID)
CREATE TABLE IF NOT EXISTS `user_devices` (
  `id`      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `hw`      VARCHAR(64) NULL,
  `dv`      VARCHAR(64) NULL,
  `ip`      VARCHAR(64) NULL,
  `last_ms` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_dev_user` (`user_id`),
  CONSTRAINT `fk_dev_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

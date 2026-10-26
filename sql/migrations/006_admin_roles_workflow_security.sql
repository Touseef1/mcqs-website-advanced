USE mcqs_website;

-- Preserve accounts while translating the old role vocabulary.
ALTER TABLE admin_users
  MODIFY role ENUM('admin','editor','reviewer','super_admin','data_entry','publisher') NOT NULL DEFAULT 'data_entry';
UPDATE admin_users SET role = 'data_entry' WHERE role = 'editor';
-- The old UI exposed database role `admin` as Paper Manager; preserve its prior scope.
UPDATE admin_users SET role = 'publisher' WHERE role = 'admin';
ALTER TABLE admin_users
  MODIFY role ENUM('super_admin','admin','data_entry','reviewer','publisher') NOT NULL DEFAULT 'data_entry',
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN session_version INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN last_login_at DATETIME NULL,
  ADD COLUMN failed_login_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN locked_until DATETIME NULL;

ALTER TABLE questions
  MODIFY status ENUM('draft','in_review','approved','published','rejected','archived') NOT NULL DEFAULT 'draft',
  ADD COLUMN created_by BIGINT UNSIGNED NULL,
  ADD COLUMN updated_by BIGINT UNSIGNED NULL,
  ADD COLUMN reviewed_by BIGINT UNSIGNED NULL,
  ADD COLUMN reviewed_at DATETIME NULL,
  ADD COLUMN review_note TEXT NULL,
  ADD KEY idx_questions_owner_status (created_by,status);
ALTER TABLE papers
  ADD COLUMN created_by BIGINT UNSIGNED NULL,
  ADD COLUMN updated_by BIGINT UNSIGNED NULL;
ALTER TABLE subjects
  ADD COLUMN created_by BIGINT UNSIGNED NULL,
  ADD COLUMN updated_by BIGINT UNSIGNED NULL;
ALTER TABLE topics
  ADD COLUMN created_by BIGINT UNSIGNED NULL,
  ADD COLUMN updated_by BIGINT UNSIGNED NULL;

CREATE TABLE IF NOT EXISTS admin_user_permissions (
  admin_user_id BIGINT UNSIGNED NOT NULL,
  permission_key VARCHAR(80) NOT NULL,
  allowed TINYINT(1) NOT NULL,
  granted_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (admin_user_id, permission_key),
  CONSTRAINT fk_admin_permission_user FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  old_values JSON NULL,
  new_values JSON NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_audit_entity (entity_type,entity_id,created_at),
  KEY idx_admin_audit_actor (admin_id,created_at),
  CONSTRAINT fk_admin_audit_actor FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  ip VARCHAR(45) NOT NULL,
  succeeded TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY idx_login_attempt_email_time (email,created_at), KEY idx_login_attempt_ip_time (ip,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing content retains its current visibility. New content uses the review workflow.

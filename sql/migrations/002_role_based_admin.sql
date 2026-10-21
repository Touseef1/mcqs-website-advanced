USE mcqs_website;

ALTER TABLE subjects
  MODIFY status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published';

ALTER TABLE topics
  MODIFY status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published';

ALTER TABLE questions
  MODIFY status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft';

ALTER TABLE papers
  MODIFY status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'published';

CREATE TABLE IF NOT EXISTS admin_users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(140) NOT NULL,
    email VARCHAR(190) NOT NULL,
    password_hash VARCHAR(180) NOT NULL,
    role ENUM('admin', 'editor', 'reviewer') NOT NULL DEFAULT 'editor',
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_admin_users_email (email),
    KEY idx_admin_users_role_status (role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

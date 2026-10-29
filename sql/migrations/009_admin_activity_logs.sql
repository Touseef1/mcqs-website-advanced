USE mcqs_website;

-- Activity snapshots used by the Super Admin activity view.
-- user_id intentionally has no FK so a removed staff account does not erase history.
CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  user_name VARCHAR(140) NOT NULL,
  user_role ENUM('super_admin','admin','data_entry','reviewer','publisher') NOT NULL,
  action_type VARCHAR(40) NOT NULL,
  target_type ENUM('mcq','paper') NULL,
  target_id BIGINT UNSIGNED NULL,
  target_title VARCHAR(500) NULL,
  ip_address VARCHAR(45) NULL,
  occurred_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_activity_time (occurred_at, id),
  KEY idx_activity_user_time (user_id, occurred_at, id),
  KEY idx_activity_action_time (action_type, occurred_at, id),
  KEY idx_activity_target (target_type, target_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

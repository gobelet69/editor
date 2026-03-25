DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS folders;
DROP TABLE IF EXISTS project_members;
DROP TABLE IF EXISTS projects;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  git_repo TEXT DEFAULT '',
  git_branch TEXT DEFAULT 'main',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT DEFAULT 'editor',
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, username)
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  project_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder_id TEXT,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT ''
);

    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP // ... existing lines ...
);

-- 播放器表
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    p_id TEXT UNIQUE NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    cover_url TEXT,
    cover_image BLOB,
    announcement TEXT,
    created_by INTEGER, -- 关联 admins.id
    stream_config TEXT, -- JSON 格式: { mode: "udp"|"echo", source: "...", headers: {...} }
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 管理员表
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 插入示例播放器数据
INSERT INTO players (name, p_id, description, url, cover_url, announcement) VALUES 
('演示播放器', 'demo-player', '这是一个演示播放器，用于测试平台功能', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg', '这是一个测试公告信息');
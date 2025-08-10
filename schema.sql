-- 播放器表
CREATE TABLE players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    p_id TEXT UNIQUE NOT NULL,
    description TEXT,
    url TEXT NOT NULL,
    cover_url TEXT,
    announcement TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 插入示例播放器数据
INSERT INTO players (name, p_id, description, url, cover_url, announcement) VALUES 
('演示播放器', 'demo-player', '这是一个演示播放器，用于测试平台功能', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg', '这是一个测试公告信息');
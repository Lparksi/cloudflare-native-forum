-- Explicit local-only fixtures. No sample topics are inserted.
INSERT INTO profiles (id, username, display_name, created_at)
VALUES ('local-developer', 'developer', '本地开发者', unixepoch() * 1000) ON CONFLICT DO NOTHING;
INSERT INTO nodes (id, slug, name, description, sort_order) VALUES
('dev', 'dev', '开发技术', '代码、工具与工程实践。', 1),
('cloud', 'cloud', '云与基础设施', '边缘计算、Serverless 与自托管。', 2),
('share', 'share', '发现与分享', '分享值得一看的作品与想法。', 3)
ON CONFLICT DO NOTHING;

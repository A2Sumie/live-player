# Online Streaming Player Management Platform

A comprehensive online streaming player management tool built to run on Cloudflare Workers. This platform allows users to browse, manage, and watch online streaming content with full administrative capabilities.

## 🚀 Features

- **Anonymous Access**: Users can browse and watch streams without authentication
- **Player Management**: Full CRUD operations for streaming players (Create, Read, Update, Delete)
- **HLS Support**: Advanced HLS streaming support with quality control and audio track selection
- **Cover Image Management**: 
  - Upload custom cover images
  - Auto-capture frames from video streams
  - Multi-frame selection for optimal covers
- **Admin Panel**: Secure administrative interface for content management
- **Responsive Design**: Mobile-friendly interface with modern UI/UX
- **Real-time Streaming**: Optimized for live streaming content

## 🛠 Tech Stack

- **Framework**: Next.js 15 with App Router (SSR)
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **ORM**: Drizzle ORM
- **Video Player**: Artplayer with HLS.js integration
- **Styling**: Tailwind CSS
- **Authentication**: JWT-based admin authentication
- **Language**: TypeScript

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd players
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your configuration
   ```

4. **Initialize the database**
   ```bash
   # Create D1 database
   wrangler d1 create live-player
   
   # Run migrations
   pnpm run db:init:dev
   ```

## 🚀 Development

1. **Start development server**
   ```bash
   pnpm dev
   ```

2. **Database operations**
   ```bash
   # Generate migrations
   pnpm run db:generate
   
   # Run migrations
   pnpm run db:migrate
   
   # Open Drizzle Studio
   pnpm run db:studio
   ```

## 🌐 Deployment

1. **Build and deploy to Cloudflare**
   ```bash
   pnpm run deploy
   ```

2. **Initialize production database**
   ```bash
   pnpm run db:init
   ```

## 📁 Project Structure

```
├── src/
│   ├── app/                 # Next.js App Router pages
│   │   ├── api/            # API endpoints
│   │   ├── admin/          # Admin panel
│   │   └── player/         # Player pages
│   ├── components/         # React components
│   │   ├── PlayerModal.tsx # Player management modal
│   │   ├── CoverSelector.tsx # Cover image selection
│   │   └── Player.tsx      # Video player component
│   ├── lib/
│   │   ├── db/             # Database schema and utilities
│   │   ├── auth.ts         # Authentication logic
│   │   └── videoCapture.ts # Video frame capture utilities
│   └── styles/
├── migrations/             # Database migrations
├── public/                # Static assets
└── scripts/               # Utility scripts
```

## 🎯 Key Features

### Video Player Management
- Create and manage multiple streaming players
- Support for various video formats (MP4, HLS, etc.)
- Custom player configurations and settings

### Cover Image System
- **Upload**: Direct image file uploads
- **Auto-capture**: Extract frames from video streams
- **Multi-frame selection**: Choose from 8 captured frames
- **HLS optimization**: Efficient frame extraction from HLS streams

### Admin Authentication
- Secure JWT-based authentication
- Role-based access control
- Protected admin routes

### Database Schema
```sql
-- Players table
CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  pId TEXT UNIQUE NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  coverUrl TEXT,
  coverImage BLOB,
  announcement TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
  updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
);
```

## 🔧 Configuration

### Environment Variables
```env
# JWT Secret
JWT_SECRET=your_jwt_secret_here

# Admin Credentials (optional)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin_password
```

### Cloudflare Workers Configuration
```toml
# wrangler.toml
name = "streaming-platform"
compatibility_date = "2024-01-15"

[[d1_databases]]
binding = "DB"
database_name = "live-player"
database_id = "your_database_id"
```

## 📖 API Reference

### Players API
- `GET /api/players` - List all players
- `POST /api/players` - Create new player
- `PUT /api/players/[id]` - Update player
- `DELETE /api/players/[id]` - Delete player
- `POST /api/players/[id]/cover` - Upload cover image

### Authentication API
- `POST /api/auth/login` - Admin login
- `POST /api/auth/logout` - Admin logout
- `GET /api/auth/user` - Get current user

## 🎮 Usage

### For Viewers
1. Navigate to the homepage to see all available players
2. Click on any player to start watching
3. Use player controls for quality selection and audio tracks

### For Administrators
1. Access `/auth/admin` to log in
2. Manage players through the admin interface
3. Upload cover images or capture from video streams
4. Configure player settings and announcements

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Artplayer](https://artplayer.org/) - Modern HTML5 video player
- [HLS.js](https://github.com/video-dev/hls.js/) - HLS streaming support
- [Drizzle ORM](https://orm.drizzle.team/) - Type-safe database operations
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge computing platform
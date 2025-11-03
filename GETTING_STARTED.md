# 🚀 Getting Started - Backend Setup

## Quick Start Guide

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

MongoDB connection string already configured in `.env`:
```
MONGODB_URI=mongodb+srv://helpdesk:Khus1234@@helpdesk.7fpanbz.mongodb.net/?appName=helpdesk
```

### 3. Run the Server

```bash
# Development mode (auto-reload)
npm run dev

# Production mode
npm run build
npm start
```

Server will run on: `http://localhost:5000`

### 4. Test the API

#### Health Check
```bash
curl http://localhost:5000/health
```

#### Register User
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "password123",
    "role": "tenant-admin",
    "companyName": "Test Company"
  }'
```

#### Login
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

## API Base URL

- **Development:** `http://localhost:5000/api`
- **Production:** Update `CORS_ORIGIN` in `.env` when deploying

## Frontend Integration

Update frontend API calls to point to:
```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
```

## Next Steps

1. ✅ Backend server running
2. 🔄 Connect frontend to backend
3. 🔄 Replace mock API calls with real API calls
4. 🔄 Test webhook endpoints
5. 🔄 Deploy to production


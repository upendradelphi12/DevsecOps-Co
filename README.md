# DevOps AI Monitor

A production-ready Azure DevOps monitoring portal with React + TypeScript frontend and ASP.NET Core backend.

## Structure

- `frontend/` - Vite + React + TypeScript + MUI client
- `backend/` - ASP.NET Core Web API with EF Core and JWT authentication

## Run locally

### Frontend
```powershell
git bash
cd c:\Project\frontend
yarn install
yarn dev
```

### Backend
```powershell
cd c:\Project\backend
dotnet restore
dotnet run
```

## Notes

This scaffold includes login/register pages, dashboard layout, JWT auth, and core APIs. It is ready for Azure deployment and future Azure DevOps/AKS integration.

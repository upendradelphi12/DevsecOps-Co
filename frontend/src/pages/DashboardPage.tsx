import { useMemo } from 'react';
import { Box, Container, Grid, Paper, Typography, Avatar, IconButton } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import CodeIcon from '@mui/icons-material/Code';
import StorageIcon from '@mui/icons-material/Storage';
import CloudIcon from '@mui/icons-material/Cloud';
import SecurityIcon from '@mui/icons-material/Security';
import PieChartIcon from '@mui/icons-material/PieChart';
import TimelineIcon from '@mui/icons-material/Timeline';

const navItems = [
  { title: 'Dashboard', icon: DashboardIcon },
  { title: 'Projects', icon: FolderIcon },
  { title: 'Repositories', icon: CodeIcon },
  { title: 'Azure DevOps Pipelines', icon: CloudIcon },
  { title: 'AKS Clusters', icon: StorageIcon },
  { title: 'Azure Container Apps', icon: CloudIcon },
  { title: 'Pods', icon: CodeIcon },
  { title: 'Deployments', icon: TimelineIcon },
  { title: 'Releases', icon: CloudIcon },
  { title: 'Environment', icon: StorageIcon },
  { title: 'Code Quality', icon: CodeIcon },
  { title: 'Security', icon: SecurityIcon },
  { title: 'Governance', icon: SecurityIcon },
  { title: 'Metrics', icon: PieChartIcon },
  { title: 'Reports', icon: FolderIcon },
  { title: 'Alerts', icon: NotificationsIcon },
  { title: 'AI Assistant', icon: DashboardIcon },
  { title: 'Settings', icon: SettingsIcon },
];

const metrics = [
  { title: 'Total Projects', value: '12' },
  { title: 'Running Pipelines', value: '34' },
  { title: 'Failed Pipelines', value: '3' },
  { title: 'Running Pods', value: '24' },
  { title: 'AKS Clusters', value: '3' },
  { title: 'Container Apps', value: '8' },
  { title: 'Code Coverage', value: '89%' },
  { title: 'Security Score', value: '92' },
];

export default function DashboardPage() {
  const user = useMemo(
    () => ({ name: 'Jane Doe', email: 'jane.doe@contoso.com' }),
    []
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', background: '#060b18' }}>
      <Box sx={{ width: 280, background: '#0f172a', p: 3, borderRight: '1px solid rgba(148, 163, 184, 0.1)' }}>
        <Typography variant="h6" sx={{ mb: 3, color: 'primary.main' }}>
          DevOps AI Monitor
        </Typography>
        <Box sx={{ display: 'grid', gap: 1 }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Paper key={item.title} sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, background: '#111827', color: 'text.primary' }}>
                <Icon fontSize="small" sx={{ color: 'primary.main' }} />
                <Typography variant="body2">{item.title}</Typography>
              </Paper>
            );
          })}
        </Box>
      </Box>
      <Box sx={{ flex: 1, p: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
          <Box>
            <Typography variant="h4" gutterBottom>
              Executive Dashboard
            </Typography>
            <Typography color="text.secondary">Welcome to your DevOps monitoring portal.</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton sx={{ color: 'text.primary' }}>
              <NotificationsIcon />
            </IconButton>
            <IconButton sx={{ color: 'text.primary' }}>
              <SettingsIcon />
            </IconButton>
            <Paper sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 1.5, background: '#111827' }}>
              <Avatar sx={{ bgcolor: 'primary.main' }}>{user.name.charAt(0)}</Avatar>
              <Box>
                <Typography>{user.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {user.email}
                </Typography>
              </Box>
              <LogoutIcon />
            </Paper>
          </Box>
        </Box>

        <Grid container spacing={3}>
          {metrics.map((metric) => (
            <Grid item xs={12} sm={6} md={3} key={metric.title}>
              <Paper sx={{ p: 3, background: '#111827', border: '1px solid rgba(148, 163, 184, 0.08)' }}>
                <Typography variant="subtitle2" color="text.secondary">
                  {metric.title}
                </Typography>
                <Typography variant="h5" sx={{ mt: 1 }}>
                  {metric.value}
                </Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>

        <Grid container spacing={3} sx={{ mt: 3 }}>
          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 3, minHeight: 320, background: '#111827' }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Pipeline Success Trend
              </Typography>
              <Box sx={{ height: 260, background: '#0b1225', borderRadius: 2 }} />
            </Paper>
          </Grid>
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 3, minHeight: 320, background: '#111827' }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                AKS CPU Usage
              </Typography>
              <Box sx={{ height: 260, background: '#0b1225', borderRadius: 2 }} />
            </Paper>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}

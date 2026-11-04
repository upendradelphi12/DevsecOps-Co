import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box,
  Button,
  Checkbox,
  Container,
  FormControlLabel,
  Link,
  Paper,
  TextField,
  Typography,
} from '@mui/material';

const schema = z.object({
  email: z.string().email('Enter a valid business email').refine((value) => !value.match(/@(gmail|yahoo|outlook|hotmail|live)\./i), 'Use a business email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  remember: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { remember: true },
  });

  const onSubmit = () => {
    navigate('/dashboard');
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Paper sx={{ p: 4, borderRadius: 4, background: '#091228' }} elevation={6}>
        <Typography variant="h4" gutterBottom>
          Sign in to DevOps AI Monitor
        </Typography>
        <Typography sx={{ mb: 3, color: 'text.secondary' }}>
          Monitor Azure DevOps pipelines, AKS clusters, and Container Apps.
        </Typography>
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <TextField
            label="Business Email"
            fullWidth
            margin="normal"
            {...register('email')}
            error={Boolean(errors.email)}
            helperText={errors.email?.message}
          />
          <TextField
            label="Password"
            type="password"
            fullWidth
            margin="normal"
            {...register('password')}
            error={Boolean(errors.password)}
            helperText={errors.password?.message}
          />
          <FormControlLabel
            control={<Checkbox {...register('remember')} defaultChecked />}
            label="Remember me"
          />
          <Button type="submit" variant="contained" fullWidth sx={{ mt: 2, mb: 1 }}>
            Login
          </Button>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
            <Link component={RouterLink} to="#" underline="hover">
              Forgot password?
            </Link>
            <Link component={RouterLink} to="/register" underline="hover">
              Register
            </Link>
          </Box>
        </Box>
      </Paper>
    </Container>
  );
}

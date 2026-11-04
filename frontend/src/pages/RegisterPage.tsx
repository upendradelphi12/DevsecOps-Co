import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box,
  Button,
  Container,
  Paper,
  TextField,
  Typography,
} from '@mui/material';

const schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  company: z.string().min(1, 'Company name is required'),
  email: z.string().email('Enter a valid business email').refine((value) => !value.match(/@(gmail|yahoo|outlook|hotmail|live)\./i), 'Use a business email'),
  phone: z.string().min(10, 'Enter a valid phone number'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(8, 'Confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = () => {
    navigate('/login');
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Paper sx={{ p: 4, borderRadius: 4, background: '#091228' }} elevation={6}>
        <Typography variant="h4" gutterBottom>
          Create your account
        </Typography>
        <Typography sx={{ mb: 3, color: 'text.secondary' }}>
          Register with your business email to access DevOps AI Monitor.
        </Typography>
        <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          <TextField
            label="First Name"
            fullWidth
            margin="normal"
            {...register('firstName')}
            error={Boolean(errors.firstName)}
            helperText={errors.firstName?.message}
          />
          <TextField
            label="Last Name"
            fullWidth
            margin="normal"
            {...register('lastName')}
            error={Boolean(errors.lastName)}
            helperText={errors.lastName?.message}
          />
          <TextField
            label="Company Name"
            fullWidth
            margin="normal"
            {...register('company')}
            error={Boolean(errors.company)}
            helperText={errors.company?.message}
          />
          <TextField
            label="Business Email"
            fullWidth
            margin="normal"
            {...register('email')}
            error={Boolean(errors.email)}
            helperText={errors.email?.message}
          />
          <TextField
            label="Mobile Number"
            fullWidth
            margin="normal"
            {...register('phone')}
            error={Boolean(errors.phone)}
            helperText={errors.phone?.message}
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
          <TextField
            label="Confirm Password"
            type="password"
            fullWidth
            margin="normal"
            {...register('confirmPassword')}
            error={Boolean(errors.confirmPassword)}
            helperText={errors.confirmPassword?.message}
          />
          <Button type="submit" variant="contained" fullWidth sx={{ mt: 2, mb: 1 }}>
            Register
          </Button>
          <Typography sx={{ mt: 2, color: 'text.secondary' }}>
            Already have an account?{' '}
            <Link component={RouterLink} to="/login">Sign in</Link>
          </Typography>
        </Box>
      </Paper>
    </Container>
  );
}

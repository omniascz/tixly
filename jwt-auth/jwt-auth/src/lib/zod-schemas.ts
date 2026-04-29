import { z } from 'zod';

export const LoginBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const LogoutBodySchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type LoginBody = z.infer<typeof LoginBodySchema>;
export type RefreshBody = z.infer<typeof RefreshBodySchema>;
export type LogoutBody = z.infer<typeof LogoutBodySchema>;

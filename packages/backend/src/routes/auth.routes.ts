import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation.js';
import { login } from '../controllers/auth.controller.js';

const loginSchema = z.object({
  password: z.string().min(1),
});

const router = Router();

router.post('/login', validate({ body: loginSchema }), login);

export default router;

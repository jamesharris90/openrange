const request = require('supertest');
const express = require('express');
const userRoutes = require('../users/routes');

// Create a test app
const app = express();
app.use(express.json());
app.use('/api/users', userRoutes);

describe('User Registration', () => {
  test('should reject registration without required fields', async () => {
    const response = await request(app)
      .post('/api/users/register')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  test('should reject invalid email format', async () => {
    const response = await request(app)
      .post('/api/users/register')
      .send({
        username: 'testuser',
        email: 'invalid-email',
        password: 'Test1234'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('email');
  });

  test('should reject weak password', async () => {
    const response = await request(app)
      .post('/api/users/register')
      .send({
        username: 'testuser',
        email: 'test@example.com',
        password: 'weak'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Password');
  });

  test('should reject invalid username', async () => {
    const response = await request(app)
      .post('/api/users/register')
      .send({
        username: 'ab',
        email: 'test@example.com',
        password: 'Test1234'
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Username');
  });
});

describe('User Login', () => {
  test('should reject login without credentials', async () => {
    const response = await request(app)
      .post('/api/users/login')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  test('should reject login with invalid credentials', async () => {
    const response = await request(app)
      .post('/api/users/login')
      .send({
        identifier: 'nonexistent@example.com',
        password: 'wrongpassword'
      });

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });
});

describe('User Profile', () => {
  test('should reject profile access without token', async () => {
    const response = await request(app)
      .get('/api/users/profile');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });

  test('should reject profile access with invalid token', async () => {
    const response = await request(app)
      .get('/api/users/profile')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body).toHaveProperty('error');
  });
});

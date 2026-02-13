/**
 * Tests for input validation functions
 * These tests verify that validation logic works correctly
 */

describe('Username Validation', () => {
  // Mock validation function (would be imported from actual module)
  function validateUsername(username) {
    if (typeof username !== 'string') return 'Username must be a string';
    if (username.length < 3 || username.length > 20) return 'Username must be 3-20 characters';
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return 'Username can only contain letters, numbers, hyphens, and underscores';
    return null;
  }

  test('should accept valid usernames', () => {
    expect(validateUsername('user123')).toBeNull();
    expect(validateUsername('test_user')).toBeNull();
    expect(validateUsername('trader-1')).toBeNull();
  });

  test('should reject short usernames', () => {
    expect(validateUsername('ab')).toContain('3-20 characters');
  });

  test('should reject long usernames', () => {
    expect(validateUsername('a'.repeat(21))).toContain('3-20 characters');
  });

  test('should reject usernames with special characters', () => {
    expect(validateUsername('user@123')).toContain('letters, numbers');
    expect(validateUsername('user#test')).toContain('letters, numbers');
  });

  test('should reject non-string usernames', () => {
    expect(validateUsername(123)).toContain('must be a string');
    expect(validateUsername(null)).toContain('must be a string');
  });
});

describe('Email Validation', () => {
  function validateEmail(email) {
    if (typeof email !== 'string') return 'Email must be a string';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return 'Invalid email format';
    if (email.length > 255) return 'Email is too long';
    return null;
  }

  test('should accept valid emails', () => {
    expect(validateEmail('test@example.com')).toBeNull();
    expect(validateEmail('user.name@domain.co.uk')).toBeNull();
    expect(validateEmail('trader+tags@example.com')).toBeNull();
  });

  test('should reject invalid email formats', () => {
    expect(validateEmail('notanemail')).toContain('Invalid email');
    expect(validateEmail('missing@domain')).toContain('Invalid email');
    expect(validateEmail('@nodomain.com')).toContain('Invalid email');
  });

  test('should reject very long emails', () => {
    const longEmail = 'a'.repeat(250) + '@test.com';
    expect(validateEmail(longEmail)).toContain('too long');
  });
});

describe('Password Validation', () => {
  function validatePassword(password) {
    if (typeof password !== 'string') return 'Password must be a string';
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (password.length > 128) return 'Password is too long';
    if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
    return null;
  }

  test('should accept valid passwords', () => {
    expect(validatePassword('Password123')).toBeNull();
    expect(validatePassword('MySecure1Pass')).toBeNull();
    expect(validatePassword('Test1234')).toBeNull();
  });

  test('should reject short passwords', () => {
    expect(validatePassword('Pass1')).toContain('at least 8 characters');
  });

  test('should reject passwords without lowercase', () => {
    expect(validatePassword('PASSWORD123')).toContain('lowercase letter');
  });

  test('should reject passwords without uppercase', () => {
    expect(validatePassword('password123')).toContain('uppercase letter');
  });

  test('should reject passwords without numbers', () => {
    expect(validatePassword('PasswordTest')).toContain('number');
  });

  test('should reject very long passwords', () => {
    const longPass = 'Aa1' + 'a'.repeat(130);
    expect(validatePassword(longPass)).toContain('too long');
  });
});

export const JWT_ALGORITHM = 'HS256' as const;
export const JWT_ISSUER = 'realtytechai-api';
export const JWT_AUDIENCE = 'realtytechai-app';

export const JWT_SIGN_OPTIONS = {
  algorithm: JWT_ALGORITHM,
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
  expiresIn: '12h' as const,
};

export const JWT_VERIFY_OPTIONS = {
  algorithms: [JWT_ALGORITHM],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
};

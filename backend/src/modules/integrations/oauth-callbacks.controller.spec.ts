import type { Response } from 'express';
import { CalendarController } from '../calendar/calendar.controller';
import { IntegrationsController } from './integrations.controller';

function redirectResponse() {
  const redirect = jest.fn((url: string) => url);
  return { response: { redirect } as unknown as Response, redirect };
}

describe('OAuth callback browser handoff contracts', () => {
  const originalFrontend = process.env.FRONTEND_URL;

  afterEach(() => {
    if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontend;
  });

  it('returns Google to the same scheduling feedback contract as other providers', async () => {
    process.env.FRONTEND_URL = 'https://www.realtytechai.app/';
    const calendar = {
      completeGoogleOAuth: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new CalendarController(
      calendar as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const { response, redirect } = redirectResponse();

    await controller.callback(response, 'authorization-code', 'signed-state');

    expect(calendar.completeGoogleOAuth).toHaveBeenCalledWith(
      'authorization-code',
      'signed-state',
    );
    expect(redirect).toHaveBeenCalledWith(
      'https://www.realtytechai.app/app/integrations?scheduling=google&status=choose',
    );
  });

  it('returns a safe scheduling error and never calls the provider after denial', async () => {
    const calendar = { completeGoogleOAuth: jest.fn() };
    const controller = new CalendarController(
      calendar as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const { response, redirect } = redirectResponse();

    await controller.callback(
      response,
      undefined,
      undefined,
      'access_denied with provider details',
    );

    expect(calendar.completeGoogleOAuth).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(
      'http://localhost:3000/app/integrations?scheduling=google&status=error&code=OAUTH_DENIED',
    );
  });

  it('distinguishes a malformed scheduling callback from a provider denial', async () => {
    const calendar = { completeGoogleOAuth: jest.fn() };
    const controller = new CalendarController(
      calendar as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const { response, redirect } = redirectResponse();

    await controller.callback(response, undefined, 'signed-state');

    expect(calendar.completeGoogleOAuth).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(
      'http://localhost:3000/app/integrations?scheduling=google&status=error&code=OAUTH_CALLBACK_INVALID',
    );
  });

  it('does not place Facebook provider responses or secrets in the redirect URL', async () => {
    process.env.FRONTEND_URL = 'https://www.realtytechai.app/';
    const integrations = {
      facebookOAuthCallback: jest.fn().mockResolvedValue({
        ok: false,
        error: 'Graph response contained access_token=provider-secret',
      }),
    };
    const controller = new IntegrationsController(integrations as any);
    const { response, redirect } = redirectResponse();

    await controller.facebookCallback(
      {} as any,
      response,
      'authorization-code',
      'signed-state',
    );

    const location = redirect.mock.calls[0][0];
    expect(location).toBe(
      'https://www.realtytechai.app/app/integrations?facebook=error&code=OAUTH_FAILED',
    );
    expect(location).not.toContain('provider-secret');
    expect(location).not.toContain('access_token');
  });
});

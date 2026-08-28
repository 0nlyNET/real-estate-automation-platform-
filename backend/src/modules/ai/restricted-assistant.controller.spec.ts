import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ClientAssistantController,
  OperationsAssistantController,
} from './restricted-assistant.controller';
import { RestrictedAssistantService } from './restricted-assistant.service';

class AuthenticatedTestGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getRequest().user = {
      sub: '00000000-0000-4000-8000-000000000001',
      tenantId: '00000000-0000-4000-8000-000000000002',
      email: 'owner@example.com',
      role: 'owner',
      platformRole: 'super_admin',
      platformOperator: true,
    };
    return true;
  }
}

class AllowTestGuard implements CanActivate {
  canActivate() {
    return true;
  }
}

describe('restricted assistant HTTP contracts', () => {
  let app: INestApplication;
  const assistant = {
    askClient: jest.fn(),
    confirmClient: jest.fn(),
    historyClient: jest.fn(),
    clientStatus: jest.fn(),
    askOperations: jest.fn(),
    confirmOperations: jest.fn(),
    historyOperations: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ClientAssistantController, OperationsAssistantController],
      providers: [{ provide: RestrictedAssistantService, useValue: assistant }],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AuthenticatedTestGuard)
      .overrideGuard(PlatformOperatorGuard)
      .useClass(AllowTestGuard)
      .overrideGuard(PlatformAdminGuard)
      .useClass(AllowTestGuard)
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    assistant.askClient.mockResolvedValue({
      id: 'client-run',
      status: 'completed',
    });
    assistant.askOperations.mockResolvedValue({
      id: 'ops-run',
      status: 'completed',
    });
    assistant.historyClient.mockResolvedValue({ items: [] });
    assistant.historyOperations.mockResolvedValue({ items: [] });
    assistant.clientStatus.mockReturnValue({ available: true });
  });

  it('passes the authenticated tenant, actor, prompt, and request ID through the client route', async () => {
    const requestId = '00000000-0000-4000-8000-000000000077';
    await request(app.getHttpServer())
      .post('/ai/client-assistant')
      .send({ prompt: 'Check my readiness', requestId })
      .expect(201)
      .expect({ id: 'client-run', status: 'completed' });

    expect(assistant.askClient).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000001',
        tenantId: '00000000-0000-4000-8000-000000000002',
        role: 'owner',
      }),
      'Check my readiness',
      requestId,
    );
  });

  it('exposes actor-scoped history and safe provider readiness to the client UI', async () => {
    await request(app.getHttpServer())
      .get('/ai/client-assistant/history')
      .expect(200)
      .expect({ items: [] });
    await request(app.getHttpServer())
      .get('/ai/client-assistant/status')
      .expect(200)
      .expect({ available: true });
    expect(assistant.historyClient).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '00000000-0000-4000-8000-000000000002',
      }),
    );
  });

  it('passes the platform role into the operations assistant and confirmation routes', async () => {
    const requestId = '00000000-0000-4000-8000-000000000078';
    await request(app.getHttpServer())
      .post('/admin/ai/operations-assistant')
      .send({ prompt: 'Summarize exceptions', requestId })
      .expect(201);
    expect(assistant.askOperations).toHaveBeenCalledWith(
      expect.objectContaining({ platformRole: 'super_admin' }),
      'Summarize exceptions',
      requestId,
    );

    assistant.confirmOperations.mockResolvedValue({
      id: 'ops-run',
      status: 'completed',
    });
    await request(app.getHttpServer())
      .post(
        '/admin/ai/operations-assistant/00000000-0000-4000-8000-000000000079/confirm',
      )
      .expect(201);
    expect(assistant.confirmOperations).toHaveBeenCalledWith(
      expect.objectContaining({ platformRole: 'super_admin' }),
      '00000000-0000-4000-8000-000000000079',
    );
  });

  it('rejects malformed browser payloads before provider or database work', async () => {
    await request(app.getHttpServer())
      .post('/ai/client-assistant')
      .send({ prompt: 'x', requestId: 'not-a-uuid', unexpected: true })
      .expect(400);
    expect(assistant.askClient).not.toHaveBeenCalled();
  });
});

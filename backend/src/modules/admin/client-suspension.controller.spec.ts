import { ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { validate } from "class-validator";
import { PlatformAdminGuard } from "../../common/guards/platform-admin.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ClientSuspensionController } from "./client-suspension.controller";
import { SuspendClientDto } from "./admin.dto";

function context(user?: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

describe("POST /api/v1/admin/clients/:clientId/suspend", () => {
  const originalAdmins = process.env.PLATFORM_ADMIN_EMAILS;

  afterEach(() => {
    if (originalAdmins === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = originalAdmins;
  });

  it("is protected by authentication and the platform Super Administrator guard", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ClientSuspensionController,
    );
    expect(guards).toEqual(
      expect.arrayContaining([JwtAuthGuard, PlatformAdminGuard]),
    );
  });

  it("allows only the configured authenticated Super Administrator", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "owner@example.com";
    const guard = new PlatformAdminGuard();
    expect(
      guard.canActivate(
        context({ platformAdmin: true, email: "owner@example.com" }),
      ),
    ).toBe(true);
    for (const user of [
      undefined,
      {
        platformAdmin: false,
        platformRole: "staff",
        email: "staff@example.com",
      },
      { platformAdmin: false, role: "owner", email: "client@example.com" },
    ]) {
      expect(() => guard.canActivate(context(user))).toThrow(
        ForbiddenException,
      );
    }
  });

  it("passes validated state, actor, note, and correlation data to one transaction service", async () => {
    const serviceControl = {
      suspend: jest.fn().mockResolvedValue({
        clientId: "11111111-1111-4111-8111-111111111111",
        lifecycleStatus: "SUSPENDED",
        changed: true,
      }),
    };
    const controller = new ClientSuspensionController(serviceControl as never);
    await expect(
      controller.suspendClient(
        "11111111-1111-4111-8111-111111111111",
        {
          reason: "Client requested an operational pause.",
          internalNote: "Confirmed by the account owner.",
        },
        {
          correlationId: "request-123",
          user: { sub: "admin-1", email: "owner@example.com" },
          header: jest.fn(),
        } as never,
      ),
    ).resolves.toMatchObject({ lifecycleStatus: "SUSPENDED" });
    expect(serviceControl.suspend).toHaveBeenCalledWith({
      tenantId: "11111111-1111-4111-8111-111111111111",
      source: "manual",
      reason: "Client requested an operational pause.",
      internalNote: "Confirmed by the account owner.",
      actor: { id: "admin-1", email: "owner@example.com" },
      requestCorrelationId: "request-123",
      auditPath:
        "/api/v1/admin/clients/11111111-1111-4111-8111-111111111111/suspend",
    });
  });

  it("rejects malformed optional reason and internal-note values", async () => {
    const dto = Object.assign(new SuspendClientDto(), {
      reason: "x",
      internalNote: "",
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property).sort()).toEqual([
      "internalNote",
      "reason",
    ]);
  });
});

import { TelephonyController } from "./telephony.controller";

describe("TelephonyController", () => {
  it("returns an empty valid TwiML response without sending a reply", async () => {
    const webhooks = {
      handleTwilioInbound: jest.fn().mockResolvedValue({ status: "ok" }),
    };
    const response = {
      type: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnValue("sent"),
    };
    const controller = new TelephonyController(webhooks as never);

    await expect(
      controller.smsCallback(
        {
          From: "+14155550101",
          To: "+14155550999",
          Body: "Hello",
          MessageSid: "SM1",
        },
        { "x-twilio-signature": "valid" },
        response as never,
      ),
    ).resolves.toBe("sent");
    expect(response.type).toHaveBeenCalledWith("text/xml");
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    );
  });
});

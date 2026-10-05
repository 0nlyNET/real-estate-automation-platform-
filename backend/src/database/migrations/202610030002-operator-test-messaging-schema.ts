import { OperatorTestMessaging1740000000000 } from './202610030001-operator-test-messaging';

/** Register after the message schema. Keep the original migration identity
 * intact for databases where it was run manually. Its idempotent DDL repairs
 * both previously migrated and previously unregistered installations. */
export class OperatorTestMessagingSchema1790985600000 extends OperatorTestMessaging1740000000000 {
  name = 'OperatorTestMessagingSchema1790985600000';
}

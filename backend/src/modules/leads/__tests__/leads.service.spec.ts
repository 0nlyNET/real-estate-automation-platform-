import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeadsService } from '../leads.service';
import { Lead } from '../lead.entity';
import { TenantsService } from '../../tenants/tenants.service';
import { MessagingService } from '../../messaging/messaging.service';
import { SequencesService } from '../../sequences/sequences.service';
import { LeadEvent } from '../lead-event.entity';

const createMockRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

describe('LeadsService', () => {
  let leadsService: LeadsService;
  let leadRepo: jest.Mocked<Repository<Lead>>;
  let eventRepo: jest.Mocked<Repository<LeadEvent>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: TenantsService, useValue: { findById: jest.fn().mockResolvedValue({ id: 't1' }) } },
        { provide: MessagingService, useValue: { queueInstantResponses: jest.fn() } },
        { provide: SequencesService, useValue: { startForLead: jest.fn() } },
        { provide: getRepositoryToken(Lead), useValue: createMockRepo() },
        { provide: getRepositoryToken(LeadEvent), useValue: createMockRepo() },
      ],
    }).compile();

    leadsService = module.get(LeadsService);
    leadRepo = module.get(getRepositoryToken(Lead));
    eventRepo = module.get(getRepositoryToken(LeadEvent));
  });

  it('dedupes by email or phone', async () => {
    leadRepo.findOne.mockResolvedValueOnce({ id: 'existing' } as any);
    const lead = await leadsService.intake('t1', { fullName: 'Alex', email: 'a@test.com' });
    expect(lead.id).toBe('existing');
    expect(eventRepo.save).toHaveBeenCalled();
  });
});

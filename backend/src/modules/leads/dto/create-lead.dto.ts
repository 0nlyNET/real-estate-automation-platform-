import { LeadStage, LeadTemperature, LeadType } from '../lead.entity';

// Protected payload for agents creating a lead manually from the app.
export class CreateLeadDto {
  fullName!: string;
  email?: string;
  phone?: string;
  source?: string;
  location?: string;
  propertyInterest?: string;

  leadType?: LeadType;
  temperature?: LeadTemperature;
  stage?: LeadStage;

  budgetRange?: string;
  estimatedPrice?: string;
  preferredAreas?: string[];
  notes?: string;

  // For future: allow disabling instant responses.
  triggerAutomation?: boolean;
}

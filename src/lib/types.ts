import type {Service, StudioSettings} from '../tenants/schema.ts';
import type {BookingStatus} from './schedule.ts';

export type BookingDraft = {
  serviceId: string;
  serviceName: string;
  startUtc: string;
  endUtc: string;
  price: number;
  contactName: string;
  contactPhone: string;
  car?: string;
  comment?: string;
};

export type BookingRow = {
  id: string;
  code: string;
  tenant_slug: string;
  service_name: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  price: number;
  contact_name: string;
  contact_phone: string;
  car: string;
  comment: string;
  created_at: string;
};

/** Слот, посчитанный на клиенте для показа. */
export type Slot = {startUtc: string; endUtc: string; service: Service};

export type {StudioSettings};

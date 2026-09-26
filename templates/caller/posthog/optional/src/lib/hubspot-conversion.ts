// Optional: count a HubSpot form embed's submissions as conversions (posthog-hybrid with
// tags-via-zaraz). Browser code: import it from a <script> on the page with the embed.
//   import { trackHubSpotForm } from '../lib/hubspot-conversion';
//   trackHubSpotForm('your-hubspot-form-id', 'contact_form_submitted');
// Sends the form ID only, never what the visitor typed.
type Zaraz = { track(event: string, properties?: Record<string, unknown>): void };
type PostHogCapture = { capture(event: string, properties?: Record<string, unknown>): void };

export function trackHubSpotForm(formId: string, event = 'hubspot_form_submitted') {
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; eventName?: string; id?: string } | null;
    if (d?.type !== 'hsFormCallback' || d.eventName !== 'onFormSubmitted' || d.id !== formId) return;
    (window as { zaraz?: Zaraz }).zaraz?.track(event, { form_id: formId });
    (window.posthog as PostHogCapture | undefined)?.capture(event, { form_id: formId });
  });
}

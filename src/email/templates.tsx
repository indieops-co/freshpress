import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface ClientInviteProps {
  siteName: string;
  editorUrl: string;
  agencyName?: string;
}

export function ClientInviteEmail({ siteName, editorUrl, agencyName }: ClientInviteProps) {
  return (
    <Html>
      <Head />
      <Preview>Your {siteName} editor is ready</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Edit your website</Heading>
          <Text style={text}>
            {agencyName ? `${agencyName} has` : 'You have'} set up a self-serve editor for{' '}
            <strong>{siteName}</strong>. Click below to open your editor — you&apos;ll need the site
            password they shared with you.
          </Text>
          <Section style={btnWrap}>
            <Button style={button} href={editorUrl}>
              Open editor
            </Button>
          </Section>
          <Text style={muted}>Or copy this link: {editorUrl}</Text>
          <Hr style={hr} />
          <Text style={muted}>Powered by FreshPress</Text>
        </Container>
      </Body>
    </Html>
  );
}

export interface ContactNotificationProps {
  siteName: string;
  name: string;
  email: string;
  message: string;
  pagePath?: string;
}

export function ContactNotificationEmail({
  siteName,
  name,
  email,
  message,
  pagePath,
}: ContactNotificationProps) {
  return (
    <Html>
      <Head />
      <Preview>New contact form submission for {siteName}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>New contact submission</Heading>
          <Text style={text}>
            <strong>Site:</strong> {siteName}
          </Text>
          {pagePath && (
            <Text style={text}>
              <strong>Page:</strong> {pagePath}
            </Text>
          )}
          <Text style={text}>
            <strong>From:</strong> {name} &lt;{email}&gt;
          </Text>
          <Hr style={hr} />
          <Text style={text}>{message}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export interface ReviewSubmittedProps {
  siteName: string;
  editorUrl: string;
  submittedBy: string;
  note?: string;
}

export function ReviewSubmittedEmail({ siteName, editorUrl, submittedBy, note }: ReviewSubmittedProps) {
  return (
    <Html>
      <Head />
      <Preview>Changes on {siteName} are ready for your review</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Changes ready for review</Heading>
          <Text style={text}>
            <strong>{submittedBy}</strong> submitted edits to <strong>{siteName}</strong> and is
            waiting for approval before they go live.
          </Text>
          {note && <Text style={muted}>“{note}”</Text>}
          <Section style={btnWrap}>
            <Button style={button} href={editorUrl}>
              Review &amp; publish
            </Button>
          </Section>
          <Text style={muted}>Or copy this link: {editorUrl}</Text>
          <Hr style={hr} />
          <Text style={muted}>Powered by FreshPress</Text>
        </Container>
      </Body>
    </Html>
  );
}

export interface ReviewResolvedProps {
  siteName: string;
  editorUrl: string;
  outcome: 'published' | 'rejected';
  note?: string;
}

export function ReviewResolvedEmail({ siteName, editorUrl, outcome, note }: ReviewResolvedProps) {
  const published = outcome === 'published';
  return (
    <Html>
      <Head />
      <Preview>
        {published ? `Your changes to ${siteName} are live` : `Your changes to ${siteName} need another look`}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{published ? 'Your changes are live' : 'Changes sent back'}</Heading>
          <Text style={text}>
            {published ? (
              <>Your edits to <strong>{siteName}</strong> were approved and published.</>
            ) : (
              <>Your edits to <strong>{siteName}</strong> were not published yet — a reviewer asked for
              changes.</>
            )}
          </Text>
          {note && <Text style={muted}>“{note}”</Text>}
          <Section style={btnWrap}>
            <Button style={button} href={editorUrl}>
              Open editor
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={muted}>Powered by FreshPress</Text>
        </Container>
      </Body>
    </Html>
  );
}

export interface SignupConfirmProps {
  siteName: string;
  confirmUrl: string;
}

export function SignupConfirmEmail({ siteName, confirmUrl }: SignupConfirmProps) {
  return (
    <Html>
      <Head />
      <Preview>Confirm your subscription to {siteName}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Confirm your subscription</Heading>
          <Text style={text}>
            You signed up for updates from <strong>{siteName}</strong>. Click below to confirm —
            if this wasn&apos;t you, just ignore this email and nothing will be sent.
          </Text>
          <Section style={btnWrap}>
            <Button style={button} href={confirmUrl}>
              Confirm subscription
            </Button>
          </Section>
          <Text style={muted}>Or copy this link: {confirmUrl}</Text>
          <Hr style={hr} />
          <Text style={muted}>Powered by FreshPress</Text>
        </Container>
      </Body>
    </Html>
  );
}

export interface TestEmailProps {
  siteName: string;
}

export function TestEmail({ siteName }: TestEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>FreshPress email test for {siteName}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Email is working</Heading>
          <Text style={text}>
            Resend is configured correctly for <strong>{siteName}</strong>.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = { backgroundColor: '#0f1117', fontFamily: 'Inter, system-ui, sans-serif' };
const container = {
  margin: '0 auto',
  padding: '32px 24px',
  maxWidth: '520px',
  backgroundColor: '#1a1d27',
  borderRadius: '12px',
};
const h1 = { color: '#e8eaef', fontSize: '22px', fontWeight: '600', margin: '0 0 16px' };
const text = { color: '#e8eaef', fontSize: '15px', lineHeight: '1.6', margin: '0 0 12px' };
const muted = { color: '#8b92a5', fontSize: '13px', lineHeight: '1.5', margin: '0 0 8px' };
const btnWrap = { textAlign: 'center' as const, margin: '24px 0' };
const button = {
  backgroundColor: '#6c8cff',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '8px',
  fontWeight: '600',
  textDecoration: 'none',
};
const hr = { borderColor: '#2a2f3d', margin: '24px 0' };

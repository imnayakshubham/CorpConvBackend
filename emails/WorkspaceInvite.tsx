import React from 'react';
import {
    Body, Button, Head, Html, Preview, Section, Text, Hr, Tailwind,
} from '@react-email/components';

interface WorkspaceInviteEmailProps {
    inviterName: string;
    orgName: string;
    role: string;
    inviteLink: string;
}

export default function WorkspaceInviteEmail({ inviterName, orgName, role, inviteLink }: WorkspaceInviteEmailProps) {
    const currentYear = new Date().getFullYear();

    return (
        <Html>
            <Head />
            <Tailwind>
                <Preview>You've been invited to join {orgName} on Hushwork</Preview>
                <Body className="bg-[#f0f2f5] font-sans text-[#0f172a] p-0">
                    <table cellSpacing={0} width="100%" style={{ backgroundColor: '#f0f2f5' }}>
                        <tr>
                            <td align="center">
                                <table cellPadding={0} cellSpacing={0} width={560}
                                    style={{ backgroundColor: '#ffffff', borderRadius: '12px' }}>
                                    <tr>
                                        <td>
                                            <Section style={{ textAlign: 'center', paddingTop: '2rem' }}>
                                                <Text style={{ fontSize: '1.4rem', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                                                    Hushwork
                                                </Text>
                                            </Section>

                                            <Hr style={{ borderColor: '#e2e8f0' }} />

                                            <Section className="px-8 pb-8">
                                                <Text style={{ fontSize: '1.15rem', fontWeight: '600', marginBottom: '0.5rem' }}>
                                                    You've been invited to join a workspace
                                                </Text>
                                                <Text style={{ color: '#475569', lineHeight: '1.6' }}>
                                                    <strong>{inviterName}</strong> has invited you to join{' '}
                                                    <strong>{orgName}</strong> on Hushwork as a <strong>{role}</strong>.
                                                </Text>
                                                <Text style={{ color: '#475569', lineHeight: '1.6' }}>
                                                    Click the button below to accept the invitation. This invitation expires in 48 hours.
                                                </Text>

                                                <div style={{ textAlign: 'center', margin: '32px 0' }}>
                                                    <Button
                                                        href={inviteLink}
                                                        style={{
                                                            backgroundColor: '#0f172a',
                                                            color: '#ffffff',
                                                            padding: '12px 28px',
                                                            borderRadius: '9999px',
                                                            fontSize: '15px',
                                                            fontWeight: '500',
                                                            textDecoration: 'none',
                                                            display: 'inline-block',
                                                        }}
                                                    >
                                                        Accept Invitation
                                                    </Button>
                                                </div>

                                                <Text style={{ color: '#64748b', fontSize: '0.85rem' }}>
                                                    If you didn't expect this invitation, you can safely ignore this email.
                                                </Text>
                                            </Section>

                                            <Hr style={{ borderColor: '#e2e8f0' }} />
                                            <Section style={{ paddingBottom: '1.5rem', textAlign: 'center' }}>
                                                <Text style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                                                    © {currentYear} Hushwork. All rights reserved.
                                                </Text>
                                            </Section>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </Body>
            </Tailwind>
        </Html>
    );
}

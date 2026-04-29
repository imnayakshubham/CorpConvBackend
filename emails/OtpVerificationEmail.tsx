import React from 'react';
import {
    Body, Head, Html, Preview, Section, Text, Hr, Tailwind,
} from '@react-email/components';

interface OtpVerificationEmailProps {
    otp: string;
    email: string;
    userName?: string | null;
}

export default function OtpVerificationEmail({ otp, email, userName }: OtpVerificationEmailProps) {
    const greeting = userName ? `Hi ${userName},` : 'Hi there,';
    const currentYear = new Date().getFullYear();

    return (
        <Html>
            <Head />
            <Tailwind>
                <Preview>Your Hushwork secondary email verification code: {otp}</Preview>
                <Body className="bg-[#f0f2f5] font-sans text-[#0f172a] p-0">
                    <table cellSpacing={0} width="100%" style={{ backgroundColor: '#f0f2f5' }}>
                        <tr>
                            <td align="center">
                                <table cellPadding={0} cellSpacing={0} width={560}
                                    style={{ backgroundColor: '#ffffff', borderRadius: '12px' }}>
                                    <tr>
                                        <td>
                                            {/* Header */}
                                            <Section style={{ textAlign: 'center', paddingTop: '2rem' }}>
                                                <Text style={{
                                                    fontSize: '1.4rem', fontWeight: '700',
                                                    color: '#0f172a', margin: 0,
                                                }}>
                                                    Hushwork
                                                </Text>
                                            </Section>

                                            <Hr style={{ borderColor: '#e2e8f0' }} />

                                            {/* Body */}
                                            <Section className="px-8 pb-8">
                                                <Text style={{ fontSize: '1.15rem', fontWeight: '600', marginBottom: '0.5rem' }}>
                                                    Verify your secondary email
                                                </Text>
                                                <Text style={{ color: '#475569', lineHeight: '1.6' }}>
                                                    {greeting}
                                                </Text>
                                                <Text style={{ color: '#475569', lineHeight: '1.6' }}>
                                                    You requested to add <strong>{email}</strong> as a secondary email to your
                                                    Hushwork account. Use the code below to complete verification.
                                                    This code expires in <strong>10 minutes</strong>.
                                                </Text>

                                                {/* OTP Box */}
                                                <div style={{
                                                    backgroundColor: '#f8fafc',
                                                    border: '1px solid #e2e8f0',
                                                    borderRadius: '8px',
                                                    padding: '24px',
                                                    textAlign: 'center',
                                                    margin: '24px 0',
                                                }}>
                                                    <Text style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: '600', letterSpacing: '0.1em', marginBottom: '8px' }}>
                                                        VERIFICATION CODE
                                                    </Text>
                                                    <Text style={{
                                                        fontSize: '2.5rem',
                                                        fontWeight: '800',
                                                        letterSpacing: '0.3em',
                                                        color: '#0f172a',
                                                        fontFamily: 'monospace',
                                                        margin: 0,
                                                    }}>
                                                        {otp}
                                                    </Text>
                                                </div>

                                                <Text style={{ color: '#64748b', fontSize: '0.85rem' }}>
                                                    If you didn't request this, you can safely ignore this email.
                                                    Someone may have entered your email address by mistake.
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

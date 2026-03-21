import React from 'react';
import {
    Body,
    Button,
    Head,
    Html,
    Img,
    Link,
    Preview,
    Section,
    Tailwind,
    Text,
    Hr,
} from '@react-email/components';

interface DomainUpdateEmailProps {
    actual_user_name?: string | null;
}

export default function DomainUpdateEmail({ actual_user_name }: DomainUpdateEmailProps) {
    const greeting = actual_user_name ? `Hi ${actual_user_name},` : 'Hi there,';
    const currentYear = new Date().getFullYear();

    return (
        <Html>
            <Head />
            <Tailwind>
                <Preview>Important: Hushwork is moving domains!</Preview>
                <Body className="bg-[#f0f2f5] font-sans text-[#0f172a] p-0">

                    {/* OUTER TABLE (full width & centered) */}
                    <table
                        cellSpacing={0}
                        width="100%"
                        style={{ backgroundColor: '#f0f2f5' }}
                    >
                        <tr>
                            <td align="center">

                                {/* INNER TABLE (600px fixed width – standard email container) */}
                                <table
                                    cellPadding={0}
                                    cellSpacing={0}
                                    width={600}
                                    style={{ backgroundColor: '#ffffff', borderRadius: '12px' }}
                                >
                                    <tr>
                                        <td align="center" className='parent-header'>
                                            {/* HEADER */}
                                            <Section style={{ textAlign: 'center', paddingTop: '2rem' }}>
                                                <Img
                                                    src="https://www.hushworknow.com/apple-touch-icon.png"
                                                    alt="Hushwork Logo"
                                                    width={48}
                                                    height={48}
                                                    style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '0.5rem' }}
                                                />
                                                <Text
                                                    style={{
                                                        display: 'inline-block',
                                                        verticalAlign: 'middle',
                                                        fontSize: '1.5rem',
                                                        fontWeight: '700',
                                                        color: '#0f172a',
                                                        margin: 0,
                                                    }}
                                                >
                                                    Hushwork
                                                </Text>
                                            </Section>


                                            <Hr />

                                            {/* MAIN CONTENT */}
                                            <Section className="px-6 pb-8">
                                                <Text className="text-2xl font-bold mb-4">
                                                    Big news: We’re moving!
                                                </Text>
                                                <Text className="text-lg font-medium mb-4">{greeting}</Text>
                                                <Text className="text-base text-[#475569] mb-8 leading-relaxed">
                                                    To better serve our community and provide a more reliable experience, we’ve updated our official website domain.
                                                </Text>

                                                {/* DOMAIN CHANGE PANEL */}
                                                <Section className="mb-8 text-center px-4">
                                                    <Text className="text-lg font-semibold text-[#0f172a] mb-1">
                                                        We’ve updated our domain
                                                    </Text>
                                                    <Text className="text-sm text-[#64748b] mb-4">
                                                        Here’s what’s changed:
                                                    </Text>

                                                    <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                                        <Text className="text-xs uppercase font-bold text-[#64748b] tracking-widest">
                                                            FROM
                                                        </Text>
                                                        <Text className="text-base font-medium text-[#475569] line-through" aria-disabled="true">
                                                            hushwork.org
                                                        </Text>
                                                    </div>

                                                    <Text className="text-xl font-bold text-[#94a3b8] my-2">↓</Text>

                                                    <div style={{ backgroundColor: '#0f172a', padding: '12px', borderRadius: '8px' }}>
                                                        <Text className="text-xs uppercase font-bold text-[#94a3b8] tracking-widest">
                                                            TO
                                                        </Text>
                                                        <Text className="text-lg font-bold text-white">
                                                            hushworknow.com
                                                        </Text>
                                                    </div>

                                                    <Button
                                                        href="https://www.hushworknow.com"
                                                        className="bg-[#0f172a] text-white font-bold py-3 px-6 rounded-full text-base mt-4 inline-block"
                                                    >
                                                        Visit New Site
                                                    </Button>
                                                </Section>

                                                <Hr className="border-[#e2e8f0] my-6" />

                                                <Text className="text-base text-[#475569] leading-relaxed">
                                                    • All existing links will automatically redirect to their new home.
                                                </Text>
                                                <Text className="text-base text-[#475569] leading-relaxed mt-3">
                                                    • Your account, posts, and data remain safe and accessible.
                                                </Text>
                                                <Text className="text-base text-[#475569] leading-relaxed mt-3">
                                                    • Please update your bookmarks to{' '}
                                                    <Link href="https://www.hushworknow.com" className="text-[#0f172a] underline font-bold">
                                                        hushworknow.com
                                                    </Link>
                                                    .
                                                </Text>

                                                <Section className="bg-[#f8fafc] rounded-xl p-6 text-center my-8">
                                                    <Text className="text-xs uppercase text-[#94a3b8] font-bold tracking-widest mb-3">
                                                        We’d love your feedback
                                                    </Text>
                                                    <Text className="text-base text-[#475569] mb-5 leading-relaxed">
                                                        How is your experience with the new site? Have ideas or found a bug? We’re all ears.
                                                    </Text>
                                                    <Button
                                                        href="https://www.hushworknow.com/report"
                                                        className="border border-[#e2e8f0] text-[#0f172a] font-bold text-sm py-3 px-6 rounded-full bg-transparent"
                                                    >
                                                        Drop us a note
                                                    </Button>
                                                </Section>

                                                <Hr />
                                                <Text className="text-base font-bold text-[#0f172a] text-center leading-relaxed">
                                                    Cheers, <br />The Hushwork Team
                                                </Text>
                                            </Section>

                                            <Hr />
                                            {/* FOOTER */}
                                            <Section className="pb-8 text-center text-sm text-[#94a3b8] leading-relaxed px-6">
                                                You received this because you are a registered user of Hushwork.<br />
                                                © {currentYear} Hushwork. All rights reserved.
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

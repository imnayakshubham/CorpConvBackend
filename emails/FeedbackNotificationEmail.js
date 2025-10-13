const { Html, Head, Font, Preview, Body, Container, Section, Text, Link, Hr } = require('@react-email/components');
const React = require('react');

const FeedbackNotificationEmail = ({ feedback }) => {
  const priorityColors = {
    low: "#10b981",
    medium: "#f59e0b",
    high: "#ef4444",
    critical: "#dc2626"
  };

  const typeIcons = {
    bug: "🐛",
    feature: "💡",
    ui_ux: "🎨",
    performance: "⚡",
    content: "📝",
    general: "💬"
  };

  const priorityColor = priorityColors[feedback.priority] || "#6b7280";
  const typeIcon = typeIcons[feedback.type] || "💬";
  const feedbackUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/admin/feedback/${feedback._id}`;

  return React.createElement(Html, null,
    React.createElement(Head, null,
      React.createElement(Font, {
        font_family: "Roboto",
        fallbackFontFamily: "Verdana",
        webFont: {
          url: "https://fonts.gstatic.com/s/roboto/v27/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2",
          format: "woff2",
        },
        fontWeight: 400,
        fontStyle: "normal",
      })
    ),
    React.createElement(Preview, null, `New ${feedback.type} feedback: ${feedback.title}`),
    React.createElement(Body, {
      style: {
        background_color: "#f9fafb",
        font_family: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen-Sans,Ubuntu,Cantarell,'Helvetica Neue',sans-serif",
      }
    },
      React.createElement(Container, {
        style: {
          margin: "0 auto",
          padding: "20px 0 48px",
          maxWidth: "600px",
        }
      },
        React.createElement(Section, {
          style: {
            padding: "24px",
            background_color: "white",
            border: "1px solid #e5e7eb",
            border_radius: "8px",
          }
        },
          React.createElement(Text, {
            style: {
              fontSize: "24px",
              fontWeight: "600",
              color: "#111827",
              margin: "0 0 20px",
            }
          }, `${typeIcon} New Feedback Received`),

          React.createElement(Section, {
            style: {
              background_color: "#f3f4f6",
              padding: "16px",
              border_radius: "6px",
              margin: "20px 0",
            }
          },
            React.createElement(Text, {
              style: { margin: "0 0 8px", fontSize: "14px", color: "#374151" }
            },
              React.createElement("strong", null, "Type: "),
              feedback.type.replace('_', '/').replace(/\b\w/g, l => l.toUpperCase())
            ),
            React.createElement(Text, {
              style: {
                margin: "0 0 8px",
                fontSize: "14px",
                color: priorityColor,
                fontWeight: "600"
              }
            },
              React.createElement("strong", { style: { color: "#374151" } }, "Priority: "),
              feedback.priority.replace(/\b\w/g, l => l.toUpperCase())
            ),
            React.createElement(Text, {
              style: { margin: "0 0 8px", fontSize: "14px", color: "#374151" }
            },
              React.createElement("strong", null, "Source: "),
              (feedback.source || 'manual').replace(/\b\w/g, l => l.toUpperCase())
            ),
            React.createElement(Text, {
              style: { margin: "0", fontSize: "14px", color: "#374151" }
            },
              React.createElement("strong", null, "Submitted: "),
              new Date(feedback.createdAt).toLocaleString()
            )
          ),

          React.createElement(Section, {
            style: { margin: "20px 0" }
          },
            React.createElement(Text, {
              style: {
                fontSize: "18px",
                fontWeight: "600",
                color: "#111827",
                margin: "0 0 8px"
              }
            }, feedback.title),
            React.createElement(Section, {
              style: {
                background_color: "#f9fafb",
                padding: "16px",
                border_radius: "6px",
                borderLeft: `4px solid ${priorityColor}`
              }
            },
              React.createElement(Text, {
                style: {
                  fontSize: "14px",
                  lineHeight: "20px",
                  color: "#374151",
                  margin: "0",
                  whiteSpace: "pre-wrap"
                }
              }, feedback.description)
            )
          ),

          feedback.userContext?.page && React.createElement(Text, {
            style: {
              margin: "20px 0",
              fontSize: "14px",
              color: "#374151"
            }
          },
            React.createElement("strong", null, "Page: "),
            React.createElement(Link, {
              href: feedback.userContext.page,
              style: { color: "#3b82f6", marginLeft: "8px" }
            }, feedback.userContext.page)
          ),

          React.createElement(Section, {
            style: {
              margin: "32px 0",
              textAlign: "center"
            }
          },
            React.createElement(Link, {
              href: feedbackUrl,
              style: {
                background_color: "#1f2937",
                color: "#fff",
                padding: "12px 24px",
                textDecoration: "none",
                border_radius: "6px",
                display: "inline-block",
                fontWeight: "600"
              }
            }, "View Feedback Details")
          ),

          React.createElement(Hr, {
            style: {
              borderColor: "#e5e7eb",
              margin: "32px 0"
            }
          }),

          React.createElement(Text, {
            style: {
              fontSize: "14px",
              color: "#6b7280",
              margin: "0",
              textAlign: "center"
            }
          }, "This feedback was submitted through the Hushwork feedback system.")
        )
      )
    )
  );
};

module.exports = FeedbackNotificationEmail;
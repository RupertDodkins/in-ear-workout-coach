export function Icon({ children, strokeWidth = 2.4, ...rest }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ClockIcon = (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 14" />
  </Icon>
);

export const CheckIcon = (props) => (
  <Icon strokeWidth={3} {...props}>
    <polyline points="20 6 9 17 4 12" />
  </Icon>
);

export const BoltIcon = (
  <Icon>
    <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
  </Icon>
);

export const AlertIcon = (
  <Icon>
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.29 3.86l-8.18 14.18A2 2 0 0 0 3.83 21h16.34a2 2 0 0 0 1.72-2.96L13.71 3.86a2 2 0 0 0-3.42 0z" />
  </Icon>
);

export const MicIcon = (
  <Icon strokeWidth={2}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </Icon>
);

export const SendIcon = (
  <Icon strokeWidth={2.5}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </Icon>
);

export const BrandIcon = (
  <Icon strokeWidth={2.5}>
    <path d="M6.5 6.5l11 11" />
    <path d="M21 21l-1-1" />
    <path d="M3 3l1 1" />
    <path d="M18 22l4-4" />
    <path d="M2 6l4-4" />
    <path d="M3 10l7-7" />
    <path d="M14 21l7-7" />
  </Icon>
);

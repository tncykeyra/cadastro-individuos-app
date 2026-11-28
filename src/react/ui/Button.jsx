import React, { forwardRef } from 'react';
import './button.css';

const Button = forwardRef(function Button({
  className = '',
  variant = '',
  size = '',
  iconOnly = false,
  loading = false,
  disabled = false,
  children,
  ...props
}, ref) {
  const classes = [
    'ui-button',
    variant ? 'ui-button--' + variant : '',
    size ? 'ui-button--' + size : '',
    iconOnly ? 'ui-button--icon-only' : '',
    loading ? 'ui-button--loading' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      {...props}
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading ? true : props['aria-busy']}
    >
      {children}
    </button>
  );
});

Button.displayName = 'Button';
export default Button;

interface PrintDocumentOptions {
  title: string;
  html: string;
  styles?: string;
}

export function printHtmlDocument({ title, html, styles = '' }: PrintDocumentOptions) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';

  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const frameWindow = iframe.contentWindow;
  if (!doc || !frameWindow) {
    iframe.remove();
    throw new Error('Unable to create the print frame.');
  }

  let printed = false;

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove();
    }, 1000);
  };

  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    frameWindow.focus();
    window.setTimeout(() => {
      try {
        frameWindow.print();
      } finally {
        cleanup();
      }
    }, 250);
  };

  iframe.onload = triggerPrint;

  doc.open();
  doc.write(`<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        body { margin: 0; background: #ffffff; }
        ${styles}
      </style>
    </head>
    <body>${html}</body>
  </html>`);
  doc.close();

  window.setTimeout(triggerPrint, 300);
}

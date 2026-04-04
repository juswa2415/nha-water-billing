// src/utils/formatters.ts

export const php = (n: number) =>
  '₱' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const cubicM = (n: number) => n.toFixed(2) + ' cu.m';

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

export const billPeriod = (start: string, end: string) =>
  `${formatDate(start)} – ${formatDate(end)}`;
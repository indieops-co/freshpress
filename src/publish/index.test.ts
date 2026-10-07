import { describe, it, expect } from 'vitest';
import { renderStaticBundle } from '../publish/index.js';
import type { SitePage } from '../storage/types.js';

const pages: SitePage[] = [
  {
    id: 'p1',
    path: '/',
    title: 'Home',
    content: {
      template: '<main><h1>{{slot:h}}</h1><p>{{slot:t}}</p></main>',
      slots: {
        h: { id: 'h', type: 'text', value: 'Hello', tag: 'h1', path: 'h1[0]' },
        t: { id: 't', type: 'text', value: 'World', tag: 'p', path: 'p[0]' },
      },
      slotOrder: ['h', 't'],
    },
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'p2',
    path: '/about',
    title: 'About',
    content: {
      template: '<p>{{slot:a}}</p>',
      slots: {
        a: { id: 'a', type: 'text', value: 'About us', tag: 'p', path: 'p[0]' },
      },
      slotOrder: ['a'],
    },
    updatedAt: new Date().toISOString(),
  },
];

describe('renderStaticBundle', () => {
  it('renders index and subpages', () => {
    const files = renderStaticBundle(pages);
    expect(files['index.html']).toContain('Hello');
    expect(files['about.html']).toContain('About us');
  });
});

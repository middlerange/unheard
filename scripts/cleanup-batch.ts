// ABOUTME: One-time cleanup script to delete specific batch-generated draft posts.
// ABOUTME: Run with: tsx --env-file=.env.local scripts/cleanup-batch.ts

import { deletePost, deleteIdea } from '../lib/db';

const POST_IDS = [
  '2a02a3eb-168c-4593-8b6b-40bcb2fd85cc',  // Aakash Linkedin
  'c82df5cc-5b5f-49be-9e54-8ecf41803a22',  // Aakash Twitter
  '9d02ef11-1f76-40f1-8b40-7b757364f522',  // Brand
  'a9bc67e8-97e1-4349-91dd-3236f929c782',  // smartbear style
];

async function run() {
  for (const id of POST_IDS) {
    await deletePost(id);
    console.log(`Deleted post: ${id}`);
  }
  console.log('Done.');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });

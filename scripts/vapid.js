/* Generiše VAPID par ključeva za Web Push.
   Pokretanje:  npm install && npm run vapid   */
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('');
console.log('Dodaj ovo u Vercel → Settings → Environment Variables:');
console.log('');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:info@ammarbasic.ba');
console.log('');

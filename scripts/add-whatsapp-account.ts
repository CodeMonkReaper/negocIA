// Use tsx to run TypeScript with Prisma
import { PrismaClient } from '@negocia/database';

async function addAccount() {
  const prisma = new PrismaClient();
  
  try {
    const account = await prisma.whatsappAccount.create({
      data: {
        id: 'wac-1',
        tenantId: 'tenant-1',
        wabaId: '1121473550347494',
        phoneNumberId: '1336241236247821',
        displayPhone: null,
        accessToken: process.env.META_ACCESS_TOKEN ?? '',
        accessTokenEncrypted: {
          iv: '',
          ciphertext: '',
          tag: ''
        },
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
    console.log('Account created successfully:');
    console.log(JSON.stringify(account, null, 2));
  } catch (e) {
    console.error('Error creating account:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

addAccount();
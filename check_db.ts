import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

async function checkDatabase() {
  try {
    const adminApp = getApps().length === 0 ? initializeApp({
      projectId: "studio-9240700230-1dd9a"
    }) : getApps()[0];

    const db = getFirestore(adminApp);

    console.log("=== CHECKING publishedContents ===");
    const pubSnap = await db.collection('publishedContents').get();
    console.log(`Found ${pubSnap.docs.length} documents in publishedContents:`);
    pubSnap.docs.forEach(doc => {
      const data = doc.data();
      console.log(`ID: ${doc.id} | title: "${data.title}" | status: "${data.status}" | visibility: "${data.visibility}" | themePersona: "${data.themePersona}"`);
    });

    console.log("\n=== CHECKING contentProjects ===");
    const projSnap = await db.collection('contentProjects').get();
    console.log(`Found ${projSnap.docs.length} documents in contentProjects:`);
    projSnap.docs.forEach(doc => {
      const data = doc.data();
      console.log(`ID: ${doc.id} | title: "${data.title}" | status: "${data.status}" | visibility: "${data.visibility}" | themePersona: "${data.themePersona}" | ownerId: "${data.ownerId}"`);
    });

    console.log("\n=== CHECKING sites/{siteId}/blogs ===");
    const sites = ['hub2', 'hub3', 'hub4'];
    for (const siteId of sites) {
      const blogsSnap = await db.collection('sites').doc(siteId).collection('blogs').get();
      console.log(`Found ${blogsSnap.docs.length} documents in sites/${siteId}/blogs:`);
      blogsSnap.docs.forEach(doc => {
        const data = doc.data();
        console.log(`ID: ${doc.id} | title: "${data.title}" | status: "${data.status}" | visibility: "${data.visibility}" | ownerId: "${data.ownerId}"`);
      });
    }

  } catch (error) {
    console.error("Error checking database:", error);
  }
}

checkDatabase();

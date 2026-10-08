import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import fs from 'fs';

async function checkDatabaseClient() {
  try {
    const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
    const app = initializeApp(config);
    const db = getFirestore(app, config.firestoreDatabaseId);

    console.log("=== CHECKING publishedContents ===");
    try {
      const pubCol = collection(db, 'publishedContents');
      const q = query(pubCol, where('status', '==', 'published'));
      const snapshot = await getDocs(q);
      console.log(`Found ${snapshot.docs.length} documents in publishedContents with status=='published':`);
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        console.log(`ID: ${doc.id} | title: "${data.title}" | themePersona: "${data.themePersona}"`);
      });
    } catch (err: any) {
      console.warn("Failed checking publishedContents with query:", err.message);
    }

    console.log("\n=== CHECKING contentProjects ===");
    try {
      const projCol = collection(db, 'contentProjects');
      const q = query(projCol, where('status', '==', 'published'));
      const snapshot = await getDocs(q);
      console.log(`Found ${snapshot.docs.length} documents in contentProjects with status=='published':`);
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        console.log(`ID: ${doc.id} | title: "${data.title}" | themePersona: "${data.themePersona}"`);
      });
    } catch (err: any) {
      console.warn("Failed checking contentProjects with query:", err.message);
    }

    console.log("\n=== CHECKING sites/{siteId}/blogs ===");
    const sites = ['hub2', 'hub3', 'hub4'];
    for (const siteId of sites) {
      try {
        const blogsCol = collection(db, 'sites', siteId, 'blogs');
        const q = query(blogsCol, where('status', '==', 'published'));
        const snapshot = await getDocs(q);
        console.log(`Found ${snapshot.docs.length} documents in sites/${siteId}/blogs with status=='published':`);
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          console.log(`ID: ${doc.id} | title: "${data.title}"`);
        });
      } catch (err: any) {
        console.warn(`Failed checking sites/${siteId}/blogs with query:`, err.message);
      }
    }

  } catch (error) {
    console.error("Error in client database check:", error);
  } finally {
    process.exit(0);
  }
}

checkDatabaseClient();

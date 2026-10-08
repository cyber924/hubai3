import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import * as fs from 'fs';

async function runMigration() {
  try {
    const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
    const app = initializeApp(config);
    const db = getFirestore(app, config.firestoreDatabaseId);

    console.log("Checking publishedContents collection...");
    const pubCol = collection(db, 'publishedContents');
    const snapshot = await getDocs(pubCol);
    console.log(`Found ${snapshot.docs.length} total documents in publishedContents.`);

    let updatedCount = 0;
    for (const d of snapshot.docs) {
      const data = d.data();
      let needsUpdate = false;
      const updatePayload: any = {};

      if (!data.status) {
        updatePayload.status = 'published';
        needsUpdate = true;
      }
      if (!data.visibility) {
        updatePayload.visibility = 'public';
        needsUpdate = true;
      }

      if (needsUpdate) {
        console.log(`Updating document ID: ${d.id}...`);
        await updateDoc(doc(db, 'publishedContents', d.id), updatePayload);
        updatedCount++;
      }
    }

    console.log(`Migration finished. Updated ${updatedCount} documents.`);
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

runMigration();

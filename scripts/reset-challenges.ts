import { getDb } from "../server/db";
import { challenges, quizQuestions } from "../drizzle/schema";

async function resetChallenges() {
  const db = await getDb();
  if (!db) {
    console.error("Failed to connect to database");
    process.exit(1);
  }

  try {
    console.log("Clearing all challenges and quiz questions...");
    
    // Delete all quiz questions first (foreign key constraint)
    await db.delete(quizQuestions);
    console.log("✓ Cleared quiz questions");
    
    // Delete all challenges
    await db.delete(challenges);
    console.log("✓ Cleared challenges");

    // Create new challenge
    console.log("Creating new challenge...");
    await db.insert(challenges).values({
      challengeId: "detail-detailing-demo-001",
      title: "Detail Detailing Mastery",
      prizeName: "Premium Detail Kit",
      prizeEmoji: "🎁",
      isActive: "yes",
      expiresAt: "2026-04-10",
      createdBy: "admin",
    } as any);
    console.log("✓ Created challenge");

    // Add quiz questions one by one
    console.log("Adding quiz questions...");
    const questions = [
      {
        questionId: "q1-detail-001",
        challengeId: "detail-detailing-demo-001",
        orderIndex: 1,
        questionText: "What is the most important step in the detail detailing process?",
        optionA: "Washing the exterior thoroughly",
        optionB: "Applying wax and sealant",
        optionC: "Interior vacuuming",
        optionD: "Tire dressing",
        correctAnswer: "A",
        explanation: "Washing the exterior thoroughly is the foundation of any detail detailing job.",
      },
      {
        questionId: "q2-detail-002",
        challengeId: "detail-detailing-demo-001",
        orderIndex: 2,
        questionText: "How often should you recommend customers get professional detail detailing?",
        optionA: "Every 3 months",
        optionB: "Every 6 months",
        optionC: "Every 12 months",
        optionD: "Only when visibly dirty",
        correctAnswer: "B",
        explanation: "Professional detail detailing every 6 months maintains the vehicle's appearance.",
      },
      {
        questionId: "q3-detail-003",
        challengeId: "detail-detailing-demo-001",
        orderIndex: 3,
        questionText: "What is the correct technique for applying ceramic coating?",
        optionA: "Apply in circular motions",
        optionB: "Apply in straight lines following the paint direction",
        optionC: "Apply randomly for better coverage",
        optionD: "Apply only on visible areas",
        correctAnswer: "B",
        explanation: "Applying ceramic coating in straight lines ensures even coverage.",
      },
    ];

    for (const q of questions) {
      await db.insert(quizQuestions).values(q as any);
    }
    console.log("✓ Added quiz questions");

    console.log("\n✅ Challenges reset successfully!");
    console.log("Challenge: Detail Detailing Mastery");
    console.log("Expires: April 10, 2026");
    console.log("Questions: 3");
  } catch (error) {
    console.error("Error resetting challenges:", error);
    process.exit(1);
  }
}

resetChallenges();

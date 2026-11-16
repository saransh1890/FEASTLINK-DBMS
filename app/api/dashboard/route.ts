
import { NextResponse } from 'next/server';
import { pool, mongoDb } from '@/lib/db';
import { requireUser } from '@/lib/http';

export async function GET() {
  const { user, response } = await requireUser();

  if (response) return response;

  try {
    const userId = user!.userId;
    const role = user!.role;

    let where = '';
    let params: any[] = [];

    if (role === 'ORGANIZER') {
      where = 'WHERE e.organizer_id = ?';
      params = [userId];
    } else if (role === 'SHELTER_ADMIN') {
      where = `
        WHERE r.shelter_id = (
          SELECT shelter_id
          FROM shelter_homes
          WHERE user_id = ?
        )
      `;
      params = [userId];
    }

    // 1. Food listing statistics
    const foodCondition =
      role === 'ORGANIZER'
        ? 'WHERE e.organizer_id = ?'
        : role === 'SHELTER_ADMIN'
        ? `WHERE EXISTS (
            SELECT 1
            FROM food_requests r
            WHERE r.food_id = sf.food_id
            AND r.shelter_id = (
              SELECT shelter_id
              FROM shelter_homes
              WHERE user_id = ?
            )
          )`
        : '';

    const foodParams =
      role === 'ORGANIZER' || role === 'SHELTER_ADMIN'
        ? [userId]
        : [];

    const [food]: any = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(sf.estimated_meals), 0) AS meals,
         COALESCE(SUM(
           GREATEST(
             sf.estimated_meals - COALESCE(
               (
                 SELECT SUM(fr.requested_meals)
                 FROM food_requests fr
                 WHERE fr.food_id = sf.food_id
                   AND fr.status = 'APPROVED'
               ), 0
             ),
             0
           )
         ), 0) AS availableMeals
       FROM surplus_food sf
       JOIN events e ON e.event_id = sf.event_id
       ${foodCondition}`,
      foodParams
    );

    // 2. Food request statistics
    const [requests]: any = await pool.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(r.status = 'PENDING'), 0) AS pending,
         COALESCE(SUM(r.status = 'APPROVED'), 0) AS approved
       FROM food_requests r
       JOIN surplus_food sf ON sf.food_id = r.food_id
       JOIN events e ON e.event_id = sf.event_id
       ${where}`,
      params
    );

    // 3. Donation impact statistics
    const [impact]: any = await pool.execute(
      `SELECT
         COALESCE(SUM(h.meals_served), 0) AS meals,
         COALESCE(SUM(h.beneficiary_count), 0) AS people
       FROM donation_history h
       JOIN food_allocations a
         ON a.allocation_id = h.allocation_id
       JOIN food_requests r
         ON r.request_id = a.request_id
       JOIN surplus_food sf
         ON sf.food_id = r.food_id
       JOIN events e ON e.event_id = sf.event_id
       ${where}`,
      params
    );

    // 4. Recent food activity
    const recentCondition =
      role === 'ORGANIZER'
        ? 'WHERE e.organizer_id = ?'
        : role === 'SHELTER_ADMIN'
        ? `WHERE sf.status IN ('AVAILABLE', 'REQUESTED', 'ALLOCATED')
           AND sf.available_until > NOW()`
        : '';

    const recentParams =
      role === 'ORGANIZER' ? [userId] : [];

    const [recent]: any = await pool.execute(
      `SELECT
         sf.food_id,
         sf.food_name,
         sf.food_type,
         sf.estimated_meals,
         GREATEST(
           sf.estimated_meals - COALESCE(
             (
               SELECT SUM(fr.requested_meals)
               FROM food_requests fr
               WHERE fr.food_id = sf.food_id
                 AND fr.status = 'APPROVED'
             ), 0
           ),
           0
         ) AS available_meals,
         sf.available_until,
         sf.status,
         e.event_name,
         e.location
       FROM surplus_food sf
       JOIN events e ON e.event_id = sf.event_id
       ${recentCondition}
       ORDER BY sf.created_at DESC
       LIMIT 6`,
      recentParams
    );

    // 5. MongoDB unread notifications
    let unread = 0;

    try {
      const db = await mongoDb();

      unread = await db
        .collection('notifications')
        .countDocuments({
          userId,
          read: false
        });
    } catch (mongoError) {
      console.error('MongoDB notification count failed:', mongoError);
    }

    return NextResponse.json({
      stats: {
        foodListings: Number(food[0]?.total || 0),
        mealsListed: Number(food[0]?.meals || 0),
        availableMeals: Number(food[0]?.availableMeals || 0),
        requests: Number(requests[0]?.total || 0),
        pending: Number(requests[0]?.pending || 0),
        approved: Number(requests[0]?.approved || 0),
        mealsServed: Number(impact[0]?.meals || 0),
        beneficiaries: Number(impact[0]?.people || 0),
        unread
      },
      recent
    });

  } catch (error: any) {
    console.error('Dashboard API error:', error);

    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}


import { NextRequest, NextResponse } from 'next/server';
import { pool, audit, notify } from '@/lib/db';
import { requireUser } from '@/lib/http';

// APPROVE REQUEST
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, response } = await requireUser(['ORGANIZER', 'ADMIN']);
  if (response) return response;

  const id = Number(params.id);

  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json(
      { error: 'Invalid request ID' },
      { status: 400 }
    );
  }

  const c = await pool.getConnection();

  let transactionStarted = false;
  let shelterUser = 0;
  let allocationId = 0;
  let foodId = 0;

  try {
    await c.beginTransaction();
    transactionStarted = true;

    // Find and lock the request.
    const [rows]: any = await c.execute(
      `SELECT
         r.*,
         sf.food_id,
         sf.estimated_meals,
         e.organizer_id,
         sh.user_id AS shelter_user_id
       FROM food_requests r
       JOIN surplus_food sf ON sf.food_id = r.food_id
       JOIN events e ON e.event_id = sf.event_id
       JOIN shelter_homes sh ON sh.shelter_id = r.shelter_id
       WHERE r.request_id = ?
       FOR UPDATE`,
      [id]
    );

    const r = rows[0];

    if (!r) {
      throw new Error('Request not found');
    }

    if (
      user!.role !== 'ADMIN' &&
      r.organizer_id !== user!.userId
    ) {
      throw new Error('You cannot manage this request');
    }

    if (r.status !== 'PENDING') {
      throw new Error('Only pending requests can be approved');
    }

    foodId = r.food_id;
    shelterUser = r.shelter_user_id;

    // Lock the food listing to prevent simultaneous approvals.
    const [foodRows]: any = await c.execute(
      `SELECT food_id, estimated_meals, available_until
       FROM surplus_food
       WHERE food_id = ?
       FOR UPDATE`,
      [foodId]
    );

    if (!foodRows.length) {
      throw new Error('Food listing not found');
    }

    if (new Date(foodRows[0].available_until) <= new Date()) {
      throw new Error('This food listing has expired');
    }

    const totalMeals = Number(foodRows[0].estimated_meals);
    const requestedMeals = Number(r.requested_meals);

    // Only APPROVED requests reduce availability.
    const [used]: any = await c.execute(
      `SELECT COALESCE(SUM(requested_meals), 0) AS used
       FROM food_requests
       WHERE food_id = ?
         AND status = 'APPROVED'`,
      [foodId]
    );

    const alreadyApproved = Number(used[0].used);
    const remaining = Math.max(0, totalMeals - alreadyApproved);

    // Include the current request before approving it.
    if (requestedMeals > remaining) {
      throw new Error(
        `Cannot approve this request. Only ${remaining} meals remain available.`
      );
    }

    // Approve the request.
    await c.execute(
      `UPDATE food_requests
       SET status = 'APPROVED'
       WHERE request_id = ?`,
      [id]
    );

    // Create the food allocation.
    const [allocation]: any = await c.execute(
      `INSERT INTO food_allocations
       (request_id, allocated_meals, status)
       VALUES (?, ?, 'CONFIRMED')`,
      [id, requestedMeals]
    );

    allocationId = allocation.insertId;

    // Create the delivery record.
    await c.execute(
      `INSERT INTO delivery
       (allocation_id, delivery_status)
       VALUES (?, 'PENDING')`,
      [allocationId]
    );

    // Recalculate food listing status.
    await c.execute(
      `UPDATE surplus_food sf
       SET sf.status = CASE
         WHEN sf.available_until <= NOW()
           THEN 'EXPIRED'

         WHEN (
           SELECT COALESCE(SUM(fr.requested_meals), 0)
           FROM food_requests fr
           WHERE fr.food_id = sf.food_id
             AND fr.status = 'APPROVED'
         ) >= sf.estimated_meals
           THEN 'COMPLETED'

         WHEN EXISTS (
           SELECT 1
           FROM food_requests fr
           WHERE fr.food_id = sf.food_id
             AND fr.status = 'PENDING'
         )
           THEN 'REQUESTED'

         WHEN EXISTS (
           SELECT 1
           FROM food_requests fr
           WHERE fr.food_id = sf.food_id
             AND fr.status = 'APPROVED'
         )
           THEN 'ALLOCATED'

         ELSE 'AVAILABLE'
       END
       WHERE sf.food_id = ?`,
      [foodId]
    );

    await c.commit();
    transactionStarted = false;

    // Audit and notify after successful transaction.
    await audit('REQUEST_APPROVED', user!.userId, {
      requestId: id,
      allocationId,
      foodId,
      approvedMeals: requestedMeals
    });

    await notify(
      shelterUser,
      'Food request approved',
      `Your request #${id} has been approved. Coordinate pickup with the organizer.`,
      'success'
    );

    return NextResponse.json({
      ok: true,
      message: 'Request approved successfully',
      allocationId
    });

  } catch (e: any) {
    if (transactionStarted) {
      await c.rollback();
    }

    return NextResponse.json(
      { error: e.message },
      { status: 400 }
    );

  } finally {
    c.release();
  }
}


// REJECT OR CANCEL REQUEST
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, response } = await requireUser(['ORGANIZER', 'ADMIN']);
  if (response) return response;

  const id = Number(params.id);

  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json(
      { error: 'Invalid request ID' },
      { status: 400 }
    );
  }

  const c = await pool.getConnection();

  let transactionStarted = false;
  let shelterUser = 0;
  let foodId = 0;

  try {
    const { status } = await req.json();

    if (!['REJECTED', 'CANCELLED'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
    }

    await c.beginTransaction();
    transactionStarted = true;

    // Find and lock the request.
    const [rows]: any = await c.execute(
      `SELECT
         fr.request_id,
         fr.food_id,
         fr.status,
         e.organizer_id,
         sh.user_id AS shelter_user_id
       FROM food_requests fr
       JOIN surplus_food sf ON sf.food_id = fr.food_id
       JOIN events e ON e.event_id = sf.event_id
       JOIN shelter_homes sh ON sh.shelter_id = fr.shelter_id
       WHERE fr.request_id = ?
       FOR UPDATE`,
      [id]
    );

    const r = rows[0];

    if (!r) {
      throw new Error('Request not found');
    }

    if (
      user!.role !== 'ADMIN' &&
      r.organizer_id !== user!.userId
    ) {
      throw new Error('You cannot manage this request');
    }

    if (r.status !== 'PENDING') {
      throw new Error(
        'Only pending requests can be rejected or cancelled'
      );
    }

    foodId = r.food_id;
    shelterUser = r.shelter_user_id;

    // Lock the associated food listing.
    await c.execute(
      `SELECT food_id
       FROM surplus_food
       WHERE food_id = ?
       FOR UPDATE`,
      [foodId]
    );

    // Update request status.
    await c.execute(
      `UPDATE food_requests
       SET status = ?
       WHERE request_id = ?`,
      [status, id]
    );

    // Recalculate food listing status.
    await c.execute(
      `UPDATE surplus_food sf
       SET sf.status = CASE
         WHEN sf.available_until <= NOW()
           THEN 'EXPIRED'

         WHEN (
           SELECT COALESCE(SUM(fr.requested_meals), 0)
           FROM food_requests fr
           WHERE fr.food_id = sf.food_id
             AND fr.status = 'APPROVED'
         ) >= sf.estimated_meals
           THEN 'COMPLETED'

         WHEN EXISTS (
           SELECT 1
           FROM food_requests fr
           WHERE fr.food_id = sf.food_id
             AND fr.status = 'PENDING'
         )
           THEN 'REQUESTED'

         WHEN EXISTS (
           SELECT 1
           FROM food_requests fr
           WHERE fr.food_id = sf.food_id
             AND fr.status = 'APPROVED'
         )
           THEN 'ALLOCATED'

         ELSE 'AVAILABLE'
       END
       WHERE sf.food_id = ?`,
      [foodId]
    );

    await c.commit();
    transactionStarted = false;

    await audit('REQUEST_' + status, user!.userId, {
      requestId: id,
      foodId
    });

    await notify(
      shelterUser,
      status === 'REJECTED'
        ? 'Food request rejected'
        : 'Food request cancelled',
      `Your request #${id} has been ${status.toLowerCase()}.`,
      'request'
    );

    return NextResponse.json({
      ok: true,
      message: `Request ${status.toLowerCase()} successfully`
    });

  } catch (e: any) {
    if (transactionStarted) {
      await c.rollback();
    }

    return NextResponse.json(
      { error: e.message },
      { status: 400 }
    );

  } finally {
    c.release();
  }
}

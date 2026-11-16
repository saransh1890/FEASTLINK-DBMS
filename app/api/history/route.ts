
import { NextRequest, NextResponse } from 'next/server';
import { pool, audit } from '@/lib/db';
import { requireUser } from '@/lib/http';

export async function GET() {
  const { user, response } = await requireUser();

  if (response) return response;

  try {
    let sql = `
      SELECT
        h.*,
        a.allocated_meals,
        r.request_id,
        s.shelter_name,
        s.user_id AS shelter_user_id,
        e.organizer_id,
        e.event_name,
        f.food_name
      FROM donation_history h
      JOIN food_allocations a ON a.allocation_id = h.allocation_id
      JOIN food_requests r ON r.request_id = a.request_id
      JOIN shelter_homes s ON s.shelter_id = r.shelter_id
      JOIN surplus_food f ON f.food_id = r.food_id
      JOIN events e ON e.event_id = f.event_id
    `;

    const params: any[] = [];

    if (user!.role === 'SHELTER_ADMIN') {
      sql += ' WHERE s.user_id = ?';
      params.push(user!.userId);
    } else if (user!.role === 'ORGANIZER') {
      sql += ' WHERE e.organizer_id = ?';
      params.push(user!.userId);
    }

    sql += ' ORDER BY h.completion_date DESC';

    const [rows]: any = await pool.execute(sql, params);

    return NextResponse.json({ history: rows });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireUser(['SHELTER_ADMIN']);

  if (response) return response;

  try {
    const {
      allocationId,
      mealsServed,
      beneficiaryCount,
      remarks
    } = await req.json();

    const meals = Number(mealsServed);
    const people = Number(beneficiaryCount);

    if (
      !allocationId ||
      !Number.isInteger(meals) ||
      meals < 0 ||
      !Number.isInteger(people) ||
      people < 0
    ) {
      return NextResponse.json(
        { error: 'Enter valid meal and beneficiary counts' },
        { status: 400 }
      );
    }

    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [rows]: any = await connection.execute(
        `SELECT
           a.allocated_meals,
           a.status,
           s.user_id
         FROM food_allocations a
         JOIN food_requests r ON r.request_id = a.request_id
         JOIN shelter_homes s ON s.shelter_id = r.shelter_id
         WHERE a.allocation_id = ?
         FOR UPDATE`,
        [allocationId]
      );

      const allocation = rows[0];

      if (!allocation || allocation.user_id !== user!.userId) {
        throw new Error('Allocation not found for your shelter');
      }

      if (allocation.status !== 'COMPLETED') {
        throw new Error(
          'Donation history can be recorded after delivery is completed'
        );
      }

      if (meals > Number(allocation.allocated_meals)) {
        throw new Error('Meals served cannot exceed allocated meals');
      }

      // Prevent duplicate donation records for the same allocation.
      const [existing]: any = await connection.execute(
        `SELECT donation_id
         FROM donation_history
         WHERE allocation_id = ?`,
        [allocationId]
      );

      if (existing.length > 0) {
        throw new Error(
          'Donation impact has already been recorded for this allocation'
        );
      }

      await connection.execute(
        `INSERT INTO donation_history
         (allocation_id, meals_served, beneficiary_count, remarks)
         VALUES (?, ?, ?, ?)`,
        [
          allocationId,
          meals,
          people,
          remarks || null
        ]
      );

      await connection.commit();

      await audit(
        'DONATION_RECORDED',
        user!.userId,
        { allocationId, meals, people }
      );

      return NextResponse.json(
        { ok: true },
        { status: 201 }
      );

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    );
  }
}


import { Response } from 'express';
import { AuthRequest } from '../types/express';
import { Patient, Appointment, Invoice, User, Lead, Expense, Inventory } from '../models';
import { getClinicScopedFilter } from '../middleware/clinicContext';
import { Types } from 'mongoose';
export class AnalyticsController {
  // Get comprehensive analytics data
  // static async getAnalyticsOverview(req: AuthRequest, res: Response): Promise<void> {
  //   try {
  //     const { period = '6months' } = req.query;

  //     let startDate: Date;
  //     const now = new Date();

  //     switch (period) {
  //       case '1month':
  //         startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  //         break;
  //       case '3months':
  //         startDate = new Date();
  //         startDate.setMonth(startDate.getMonth() - 3);
  //         break;
  //       case '1year':
  //         startDate = new Date(now.getFullYear(), 0, 1);
  //         break;
  //       default:
  //         startDate = new Date();
  //         startDate.setMonth(startDate.getMonth() - 6);
  //     }

  //     // Revenue and expense data with patient counts
  //     const clinicFilter = getClinicScopedFilter(req);
  //     const [revenueExpenseData, patientData] = await Promise.all([
  //       Invoice.aggregate([
  //         {
  //           $match: {
  //             ...clinicFilter,
  //             status: 'paid',
  //             paid_at: { $gte: startDate }
  //           }
  //         },
  //         {
  //           $group: {
  //             _id: {
  //               year: { $year: '$paid_at' },
  //               month: { $month: '$paid_at' }
  //             },
  //             revenue: { $sum: '$total_amount' },
  //             count: { $sum: 1 }
  //           }
  //         },
  //         {
  //           $sort: { '_id.year': -1, '_id.month': -1 }
  //         }
  //       ]),
  //       Patient.aggregate([
  //         {
  //           $match: {
  //             ...clinicFilter,
  //             created_at: { $gte: startDate }
  //           }
  //         },
  //         {
  //           $group: {
  //             _id: {
  //               year: { $year: '$created_at' },
  //               month: { $month: '$created_at' }
  //             },
  //             patients: { $sum: 1 }
  //           }
  //         },
  //         {
  //           $sort: { '_id.year': -1, '_id.month': -1 }
  //         }
  //       ])
  //     ]);

  //     // Get expense data
  //     const expenseData = await Expense.aggregate([
  //       {
  //         $match: {
  //           ...clinicFilter,
  //           status: 'paid',
  //           date: { $gte: startDate }
  //         }
  //       },
  //       {
  //         $group: {
  //           _id: {
  //             year: { $year: '$date' },
  //             month: { $month: '$date' }
  //           },
  //           expenses: { $sum: '$amount' },
  //           count: { $sum: 1 }
  //         }
  //       },
  //       {
  //         $sort: { '_id.year': -1, '_id.month': -1 }
  //       }
  //     ]);

  //     // Combine revenue, expense, and patient data
  //     const combinedData = revenueExpenseData.map((rev, index) => {
  //       const exp = expenseData.find(e => 
  //         e._id.year === rev._id.year && e._id.month === rev._id.month
  //       );
  //       const pat = patientData.find(p => 
  //         p._id.year === rev._id.year && p._id.month === rev._id.month
  //       );

  //       const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  //       return {
  //         month: monthNames[rev._id.month - 1],
  //         revenue: rev.revenue || 0,
  //         expenses: exp?.expenses || 0,
  //         patients: pat?.patients || 0,
  //         year: rev._id.year,
  //         monthNumber: rev._id.month
  //       };
  //     });

  //     res.json({
  //       success: true,
  //       data: {
  //         revenueExpenseData: combinedData,
  //         period
  //       }
  //     });
  //   } catch (error) {
  //     console.error('Get analytics overview error:', error);
  //     res.status(500).json({
  //       success: false,
  //       message: 'Internal server error'
  //     });
  //   }
  // }





  static async getAnalyticsOverview(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { period = '6months' } = req.query;

      let startDate: Date;
      const now = new Date();

      switch (period) {
        case '1month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case '3months':
          startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 3);
          break;
        case '1year':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 6);
      }
      const clinicFilter = getClinicScopedFilter(req);

      // ✅ جيب البيانات باستخدام find
      const [invoices, appointments, patients, expenses] = await Promise.all([
        Invoice.find({ ...clinicFilter, status: 'paid', paid_at: { $gte: startDate } }),
        Appointment.find({ ...clinicFilter, created_at: { $gte: startDate } }),
        Patient.find({ ...clinicFilter, created_at: { $gte: startDate } }),
        Expense.find({ ...clinicFilter, status: 'paid', date: { $gte: startDate } })
      ]);

      console.log('📊 Data found:', {
        invoices: invoices.length,
        appointments: appointments.length,
        patients: patients.length,
        expenses: expenses.length
      });

      // ✅ اعمل grouping يدوي حسب الشهر
      const monthlyData: Record<string, any> = {};
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

      // Revenue من الـ invoices
      invoices.forEach(invoice => {
        const date = invoice.paid_at || invoice.created_at;
        if (date) {
          const month = date.getMonth();
          const year = date.getFullYear();
          const key = `${year}-${month}`;

          if (!monthlyData[key]) {
            monthlyData[key] = {
              year,
              month: month + 1,
              revenue: 0,
              expenses: 0,
              patients: 0
            };
          }
          monthlyData[key].revenue += invoice.total_amount || 0;
        }
      });

      // Patients
      patients.forEach(patient => {
        const date = patient.created_at;
        if (date) {
          const month = date.getMonth();
          const year = date.getFullYear();
          const key = `${year}-${month}`;

          if (!monthlyData[key]) {
            monthlyData[key] = {
              year,
              month: month + 1,
              revenue: 0,
              expenses: 0,
              patients: 0
            };
          }
          monthlyData[key].patients++;
        }
      });

      // Expenses
      expenses.forEach(expense => {
        const date = expense.date;
        if (date) {
          const month = date.getMonth();
          const year = date.getFullYear();
          const key = `${year}-${month}`;

          if (!monthlyData[key]) {
            monthlyData[key] = {
              year,
              month: month + 1,
              revenue: 0,
              expenses: 0,
              patients: 0
            };
          }
          monthlyData[key].expenses += expense.amount || 0;
        }
      });

      // Format the data
      const combinedData = Object.values(monthlyData)
        .sort((a: any, b: any) => {
          if (a.year !== b.year) return b.year - a.year;
          return b.month - a.month;
        })
        .map((data: any) => ({
          month: monthNames[data.month - 1],
          revenue: data.revenue,
          expenses: data.expenses,
          patients: data.patients,
          year: data.year,
          monthNumber: data.month
        }));
      console.log('✅ Overview data:', combinedData);
      res.json({
        success: true,
        data: {
          revenueExpenseData: combinedData,
          period
        }
      });
    } catch (error) {
      console.error('❌ Overview error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }







  // Get department performance analytics
  // static async getDepartmentAnalytics(req: AuthRequest, res: Response): Promise<void> {
  //   try {
  //     // Mock department data - in real app, you'd have Department-linked invoices
  //     const clinicFilter = getClinicScopedFilter(req);
  //     const departmentData = await Invoice.aggregate([
  //       { $match: { ...clinicFilter, status: 'paid' } },
  //       {
  //         $lookup: {
  //           from: 'appointments',
  //           localField: 'appointment_id',
  //           foreignField: '_id',
  //           as: 'appointment'
  //         }
  //       },
  //       { $unwind: { path: '$appointment', preserveNullAndEmptyArrays: true } },
  //       {
  //         $group: {
  //           _id: '$appointment.type', // Using appointment type as department proxy
  //           revenue: { $sum: '$total_amount' },
  //           count: { $sum: 1 }
  //         }
  //       },
  //       { $sort: { revenue: -1 } }
  //     ]);

  //     // Transform to expected format with colors
  //     const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4'];
  //     const formattedData = departmentData.map((dept, index) => ({
  //       name: dept._id || 'General',
  //       revenue: dept.revenue,
  //       patients: dept.count,
  //       color: colors[index % colors.length]
  //     }));

  //     res.json({
  //       success: true,
  //       data: formattedData
  //     });
  //   } catch (error) {
  //     console.error('Get department analytics error:', error);
  //     res.status(500).json({
  //       success: false,
  //       message: 'Internal server error'
  //     });
  //   }
  // }

  static async getDepartmentAnalytics(req: AuthRequest, res: Response): Promise<void> {
    try {
      const clinicFilter = getClinicScopedFilter(req);

      // ✅ استخدم find بدل aggregation
      const appointments = await Appointment.find(clinicFilter).populate('doctor_id');

      console.log('📊 Found appointments for departments:', appointments.length);

      if (appointments.length === 0) {
        res.json({ success: true, data: [] });
        return;
      }

      // ✅ اعمل grouping يدوي حسب specialization
      const deptCounts: Record<string, { count: number, revenue: number }> = {};

      for (const apt of appointments) {
        const doctor = apt.doctor_id as any;
        const specialization = doctor?.specialization || 'General';

        if (!deptCounts[specialization]) {
          deptCounts[specialization] = { count: 0, revenue: 0 };
        }
        deptCounts[specialization].count++;
      }

      // جرب تجيب revenue من الـ invoices
      const invoices = await Invoice.find({
        ...clinicFilter,
        status: 'paid'
      }).populate({
        path: 'appointment_id',
        populate: { path: 'doctor_id' }
      });

      for (const invoice of invoices) {
        const apt = invoice.appointment_id as any;
        if (apt && apt.doctor_id) {
          const doctor = apt.doctor_id as any;
          const specialization = doctor?.specialization || 'General';
          if (deptCounts[specialization]) {
            deptCounts[specialization].revenue += invoice.total_amount || 0;
          }
        }
      }

      const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#06B6D4'];
      const formattedData = Object.entries(deptCounts)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([name, data], index) => ({
          name,
          revenue: data.revenue,
          patients: data.count,
          color: colors[index % colors.length]
        }));

      console.log('✅ Department data:', formattedData);

      res.json({
        success: true,
        data: formattedData
      });
    } catch (error) {
      console.error('❌ Department analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }











  // Get appointment status analytics
  // static async getAppointmentAnalytics(req: AuthRequest, res: Response): Promise<void> {
  //   try {
  //     const clinicFilter = getClinicScopedFilter(req);
  //     const appointmentStats = await Appointment.aggregate([
  //       {
  //         $match: clinicFilter
  //       },
  //       {
  //         $group: {
  //           _id: '$status',
  //           count: { $sum: 1 }
  //         }
  //       }
  //     ]);

  //     // Calculate percentages and add colors
  //     const total = appointmentStats.reduce((sum, stat) => sum + stat.count, 0);
  //     const colors = {
  //       'completed': '#10B981',
  //       'scheduled': '#3B82F6', 
  //       'cancelled': '#EF4444',
  //       'no-show': '#9CA3AF'
  //     };

  //     const formattedData = appointmentStats.map(stat => ({
  //       name: stat._id.charAt(0).toUpperCase() + stat._id.slice(1),
  //       value: Math.round((stat.count / total) * 100),
  //       count: stat.count,
  //       color: colors[stat._id as keyof typeof colors] || '#6B7280'
  //     }));

  //     res.json({
  //       success: true,
  //       data: formattedData
  //     });
  //   } catch (error) {
  //     console.error('Get appointment analytics error:', error);
  //     res.status(500).json({
  //       success: false,
  //       message: 'Internal server error'
  //     });
  //   }
  // }

  static async getAppointmentAnalytics(req: AuthRequest, res: Response): Promise<void> {
    try {
      const clinicFilter = getClinicScopedFilter(req);

      // ✅ استخدم find بدل aggregation
      const appointments = await Appointment.find(clinicFilter);

      console.log('📊 Found appointments:', appointments.length);

      if (appointments.length === 0) {
        res.json({ success: true, data: [] });
        return;
      }

      // ✅ اعمل grouping يدوي
      const statusCounts: Record<string, number> = {};
      appointments.forEach(apt => {
        const status = apt.status || 'unknown';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      const total = appointments.length;
      const colors = {
        'completed': '#10B981',
        'scheduled': '#3B82F6',
        'cancelled': '#EF4444',
        'no-show': '#9CA3AF',
        'pending': '#F59E0B'
      };

      const formattedData = Object.entries(statusCounts).map(([status, count]) => {
        const percentage = Math.round((count / total) * 100);
        return {
          name: status.charAt(0).toUpperCase() + status.slice(1),
          value: count,
          count: count,
          percentage: percentage,
          color: colors[status as keyof typeof colors] || '#6B7280'
        };
      });

      console.log('✅ Formatted data:', formattedData);

      res.json({
        success: true,
        data: formattedData
      });
    } catch (error) {
      console.error('❌ Error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get patient demographics analytics
  static async getPatientDemographics(req: AuthRequest, res: Response): Promise<void> {
    try {
      const clinicFilter = getClinicScopedFilter(req);

      // ✅ استخدم find بدل aggregation
      const patients = await Patient.find(clinicFilter);

      console.log('📊 Found patients for demographics:', patients.length);

      if (patients.length === 0) {
        res.json({ success: true, data: [] });
        return;
      }

      // ✅ اعمل grouping يدوي
      const ageGroups = ['0-18', '19-35', '36-50', '51-65', '65+'];
      const demographics: Record<string, { male: number, female: number }> = {};

      ageGroups.forEach(group => {
        demographics[group] = { male: 0, female: 0 };
      });

      patients.forEach(patient => {
        // حساب العمر
        let age = 0;
        if (patient.date_of_birth) {
          const birthDate = typeof patient.date_of_birth === 'string'
            ? new Date(patient.date_of_birth)
            : patient.date_of_birth;
          const today = new Date();
          age = Math.floor((today.getTime() - birthDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
        }

        // تحديد المجموعة العمرية
        let ageGroup = '65+';
        if (age <= 18) ageGroup = '0-18';
        else if (age <= 35) ageGroup = '19-35';
        else if (age <= 50) ageGroup = '36-50';
        else if (age <= 65) ageGroup = '51-65';

        // العد حسب الجنس
        const gender = patient.gender?.toLowerCase();
        if (gender === 'male') {
          demographics[ageGroup].male++;
        } else if (gender === 'female') {
          demographics[ageGroup].female++;
        }
      });

      const formattedData = ageGroups.map(ageGroup => ({
        ageGroup,
        male: demographics[ageGroup].male,
        female: demographics[ageGroup].female,
        total: demographics[ageGroup].male + demographics[ageGroup].female
      }));

      console.log('✅ Demographics data:', formattedData);

      res.json({
        success: true,
        data: formattedData
      });
    } catch (error) {
      console.error('❌ Demographics error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get top services analytics
  static async getTopServices(req: AuthRequest, res: Response): Promise<void> {
    try {
      const clinicFilter = getClinicScopedFilter(req);

      // ✅ استخدم find بدل aggregation
      const invoices = await Invoice.find({
        ...clinicFilter,
        status: 'paid'
      });

      console.log('📊 Found invoices for services:', invoices.length);

      if (invoices.length === 0) {
        res.json({ success: true, data: [] });
        return;
      }

      // ✅ اعمل grouping يدوي للخدمات
      const serviceCounts: Record<string, { count: number, revenue: number }> = {};

      invoices.forEach(invoice => {
        if (invoice.services && Array.isArray(invoice.services)) {
          invoice.services.forEach((service: any) => {
            const serviceName = service.description || 'Unknown Service';

            if (!serviceCounts[serviceName]) {
              serviceCounts[serviceName] = { count: 0, revenue: 0 };
            }

            serviceCounts[serviceName].count += service.quantity || 1;
            serviceCounts[serviceName].revenue += service.total || 0;
          });
        }
      });

      const formattedData = Object.entries(serviceCounts)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 10)
        .map(([service, data]) => ({
          service,
          count: data.count,
          revenue: data.revenue
        }));

      console.log('✅ Top services data:', formattedData);

      res.json({
        success: true,
        data: formattedData
      });
    } catch (error) {
      console.error('❌ Top services error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get payment methods analytics
  static async getPaymentMethodAnalytics(req: AuthRequest, res: Response): Promise<void> {
    try {
      const clinicFilter = getClinicScopedFilter(req);

      // ✅ استخدم find بدل aggregation
      const invoices = await Invoice.find({
        ...clinicFilter,
        status: 'paid'
      });

      console.log('📊 Found invoices for payment methods:', invoices.length);

      if (invoices.length === 0) {
        res.json({ success: true, data: [] });
        return;
      }

      // ✅ اعمل grouping يدوي لطرق الدفع
      const paymentCounts: Record<string, { count: number, amount: number }> = {};

      invoices.forEach(invoice => {
        const method = invoice.payment_method || 'Unknown';

        if (!paymentCounts[method]) {
          paymentCounts[method] = { count: 0, amount: 0 };
        }

        paymentCounts[method].count++;
        paymentCounts[method].amount += invoice.total_amount || 0;
      });

      const totalAmount = Object.values(paymentCounts).reduce((sum, data) => sum + data.amount, 0);

      const formattedData = Object.entries(paymentCounts).map(([method, data]) => ({
        method,
        percentage: totalAmount > 0 ? Math.round((data.amount / totalAmount) * 100) : 0,
        amount: data.amount,
        count: data.count
      }));

      console.log('✅ Payment methods data:', formattedData);

      res.json({
        success: true,
        data: formattedData
      });
    } catch (error) {
      console.error('❌ Payment methods error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  // Get comprehensive analytics stats
  static async getAnalyticsStats(req: AuthRequest, res: Response): Promise<void> {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const previousMonth = new Date(startOfMonth);
      previousMonth.setMonth(previousMonth.getMonth() - 1);
      const clinicFilter = getClinicScopedFilter(req);

      // ✅ جيب البيانات باستخدام find
      const [
        currentInvoices,
        currentPatients,
        currentAppointments,
        previousInvoices,
        previousPatients,
        previousAppointments,
        allAppointments,
        completedAppointments
      ] = await Promise.all([
        Invoice.find({ ...clinicFilter, status: 'paid', paid_at: { $gte: startOfMonth } }),
        Patient.find({ ...clinicFilter, created_at: { $gte: startOfMonth } }),
        Appointment.find({ ...clinicFilter, created_at: { $gte: startOfMonth } }),
        Invoice.find({ ...clinicFilter, status: 'paid', paid_at: { $gte: previousMonth, $lt: startOfMonth } }),
        Patient.find({ ...clinicFilter, created_at: { $gte: previousMonth, $lt: startOfMonth } }),
        Appointment.find({ ...clinicFilter, created_at: { $gte: previousMonth, $lt: startOfMonth } }),
        Appointment.find(clinicFilter),
        Appointment.find({ ...clinicFilter, status: 'completed' })
      ]);
      // حساب الإجماليات
      const currentRevenue = currentInvoices.reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
      const previousRevenue = previousInvoices.reduce((sum, inv) => sum + (inv.total_amount || 0), 0) || 1;

      const currentPatientsCount = currentPatients.length;
      const previousPatientsCount = previousPatients.length || 1;

      const currentAppointmentsCount = currentAppointments.length;
      const previousAppointmentsCount = previousAppointments.length || 1;
      // Calculate growth
      const revenueGrowth = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
      const patientGrowth = ((currentPatientsCount - previousPatientsCount) / previousPatientsCount) * 100;
      const appointmentGrowth = ((currentAppointmentsCount - previousAppointmentsCount) / previousAppointmentsCount) * 100;
      // Completion rate
      const completionRate = allAppointments.length > 0
        ? (completedAppointments.length / allAppointments.length) * 100
        : 0;
      const result = {
        currentMonth: {
          revenue: currentRevenue,
          patients: currentPatientsCount,
          appointments: currentAppointmentsCount,
          completionRate
        },
        growth: {
          revenue: revenueGrowth,
          patients: patientGrowth,
          appointments: appointmentGrowth
        }
      };

      console.log('✅ Stats data:', result);
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('❌ Stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
} 